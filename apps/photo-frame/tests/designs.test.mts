// Every design as the gallery opens it, and as the walkthrough opens it: it keeps to the rules, its
// words print at a size a 0.4 mm nozzle can make, and it builds with its words, its art and its
// pattern exactly as the screen composes them. In node with manifold-3d and the real fonts.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import Module from 'manifold-3d';
import { withScope, csOf } from '@vostok/manifold';
import { buildModel, inkSection } from '../src/geometry/build';
import { FIT, frameLayout } from '../src/geometry/layout';
import { outlineRecipe } from '../src/geometry/outline';
import { DESIGNS, kickstandsFor, settingsOf, type Design } from '../src/designs';
import { PHOTO_ANSWERS, PLACES, matches, photoAnswersFor, takes, withAnswers, type Answers } from '../src/choose';
import { composeInk, secondFaceOf, linesUnderFloor, type Faces } from '../src/ink';
import { patternInk } from '../src/pattern';
import { buildSettingsOf, fitSettings, magnetCountsOffered, magnetFits, magnetsOffered, patternOf, specOf, standsOffered, textSizeMax, typed, wordRoles } from '../src/rules';
import { coerceSettings } from '../src/state';
import type { FrameSettings } from '../src/settings';
import { MAGNETS, SIZES_FOR, magnetById, printOf } from '../src/sizes';
import type { Face } from '../src/text';

const wasm: any = await Module();
wasm.setup();

const FONTS_PKG = join(process.cwd(), '../../packages/fonts');
const opentype = createRequire(join(FONTS_PKG, 'package.json'))('opentype.js');
const parsed = new Map<string, Face>();
const face = (id: string): Face => {
  let f = parsed.get(id);
  if (!f) {
    const file = readFileSync(join(FONTS_PKG, 'src/fonts', `${id}.ttf`));
    f = opentype.parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)) as Face;
    parsed.set(id, f);
  }
  return f;
};
const facesFor = (s: FrameSettings): Faces => ({ main: face(s.font), second: face(secondFaceOf(s.font)), symbols: face('icon-fallback') });

let failures = 0;
let checks = 0;
function check(ok: boolean, what: string) {
  checks++;
  if (!ok) {
    failures++;
    if (failures < 40) console.error('FAIL', what);
  }
}

/** Every edge shared by exactly two triangles. */
function closed(tri: Uint32Array): boolean {
  const edges = new Map<number, number>();
  for (let t = 0; t < tri.length; t += 3) {
    for (let i = 0; i < 3; i++) {
      const a = tri[t + i]!;
      const b = tri[t + ((i + 1) % 3)]!;
      if (a === b) return false;
      const key = a < b ? a * 4194304 + b : b * 4194304 + a;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  for (const n of edges.values()) if (n !== 2) return false;
  return true;
}

let builds = 0;
const t0 = Date.now();

/** Compose what the screen would send, build it, and check the parts. */
async function build(raw: FrameSettings, what: string) {
  const s = fitSettings(raw).settings;
  const pattern = patternOf(s) ? await patternInk(frameLayout(specOf(s), printOf(s)), s.pattern, s.patternSize / 100, s.patternDx, s.patternDy) : null;
  if (patternOf(s)) check(!!pattern && pattern.rings.length > 0, `${what}: the pattern ${s.pattern} has islands`);
  const ink = composeInk(s, facesFor(s), pattern);
  check(linesUnderFloor(ink).length === 0, `${what}: every line is 3.5 mm or more (${ink.lines.map((l) => `${l.role} ${l.text.em.toFixed(1)}`).join(', ')})`);
  for (const role of wordRoles(s)) {
    if (typed(s.words[role])) check(ink.lines.some((l) => l.role === role), `${what}: the ${role} is set`);
  }
  // Every piece of every word reaches the file: the sliver filter keeps letters, dots and all.
  const words = ink.lines.flatMap((l) => l.text.rings);
  if (words.length) {
    withScope((keep) => {
      const sent = keep(csOf(wasm, words, 'Positive')).decompose().length;
      const kept = inkSection(wasm, keep, words)?.decompose().length ?? 0;
      check(kept === sent, `${what}: every piece of the words is inlaid (${kept} of ${sent})`);
    });
  }
  try {
    const r = buildModel(wasm, { s: buildSettingsOf(s), ink: ink.rings, pattern: ink.pattern, seed: 'photo-frame/test' });
    builds++;
    for (const p of [...r.print, ...r.assembled]) check(p.triVerts.length > 0 && closed(p.triVerts), `${what}: ${p.name} is a closed mesh`);
    if (ink.rings.length || ink.pattern?.rings.length) check(r.print.some((p) => p.name === 'Inlay' || p.name === 'Text'), `${what}: the second colour is inlaid`);
    check(r.preview.photo.every((v) => v.every(Number.isFinite)), `${what}: the sample photo has a place`);
  } catch (e) {
    check(false, `${what}: build threw ${(e as Error).message}`);
  }
}

// ---- The sliver filter: a cut-off scrap of pattern goes, a dot stays.
withScope((keep) => {
  const sliver = [[0, 0], [6, 0], [6, 0.2], [0, 0.2]] as [number, number][];
  const dot = Array.from({ length: 24 }, (_, i) => [20 + 0.4 * Math.cos((i / 24) * 2 * Math.PI), 0.4 * Math.sin((i / 24) * 2 * Math.PI)] as [number, number]);
  check(inkSection(wasm, keep, [sliver]) === null, 'a sliver 0.2 mm wide is not inlaid');
  check(inkSection(wasm, keep, [dot])?.decompose().length === 1, 'a dot 0.8 mm across is inlaid');
  check(inkSection(wasm, keep, [sliver, dot])?.decompose().length === 1, 'beside a sliver, the dot alone is inlaid');
});

// ---- Every design as it opens.
check(new Set(DESIGNS.map((d) => d.id)).size === DESIGNS.length, 'every design has its own id');
for (const d of DESIGNS) {
  const s = settingsOf(d);
  const { settings: fitted, notices } = fitSettings(s);
  check(notices.length === 0, `${d.id}: opens inside the rules (${notices.map((n) => n.text).join(' ')})`);
  check(JSON.stringify(fitSettings(fitted).settings) === JSON.stringify(fitted), `${d.id}: fitting it twice changes nothing`);
  for (const [role, text] of Object.entries(d.values.words ?? {})) {
    if (typed(text)) check(wordRoles(s).includes(role as never), `${d.id}: its ${role} is shown`);
  }
  const loaded = coerceSettings(JSON.parse(JSON.stringify({ app: 'photo-frame', ...s })));
  check(JSON.stringify(loaded) === JSON.stringify(s), `${d.id}: saved and loaded, it is the same`);
  await build(s, d.id);
}

// ---- Every design on every size it offers: the rules hold, and fitting twice changes nothing.
for (const d of DESIGNS) {
  for (const photo of SIZES_FOR[d.kind === 'holder' ? 'holder' : d.kind === 'frame' ? 'frame' : 'music']) {
    const s = { ...settingsOf(d), photo };
    const once = fitSettings(s).settings;
    check(JSON.stringify(fitSettings(once).settings) === JSON.stringify(once), `${d.id}/${photo}: fitting twice changes nothing`);
    if (d.kind !== 'holder') check(standsOffered(once).includes(once.stand), `${d.id}/${photo}: a stand the print takes`);
  }
}

// ---- The walkthrough: what each answer keeps, and that each kept design opens and builds as asked.
const answerSets: Answers[] = [];
for (const place of [null, ...PLACES.map((p) => p.id)]) {
  for (const photo of [null, ...photoAnswersFor(place)]) answerSets.push({ place, photo });
}
check(photoAnswersFor('keys').every((p) => p === 'mini' || p === 'isq' || p === 'other'), 'keys: only the small instant prints, or another size');
const fridgeMini = matches({ place: 'fridge', photo: 'mini' }).slice(0, 6).map((d) => d.id).join(',');
check(fridgeMini === 'soft,scallop,squiggle,ric-rac,checks,swirl', `fridge + mini: the six best are the fridge designs in gallery order (${fridgeMini})`);
let opened = 0;
for (const a of answerSets) {
  const kept = matches(a);
  check(kept.length > 0, `${JSON.stringify(a)}: some design is kept`);
  for (const d of DESIGNS) check(kept.includes(d) === takes(d, a), `${JSON.stringify(a)}/${d.id}: kept exactly when it takes the answers`);
  for (const d of kept) {
    const s = withAnswers(settingsOf(d), a);
    if (a.place === 'fridge') check(s.stand === 'magnets', `${JSON.stringify(a)}/${d.id}: on magnets`);
    if (a.place === 'keys') check(s.stand === 'keychain', `${JSON.stringify(a)}/${d.id}: on a keychain`);
    if (a.photo && a.photo !== 'other') check(s.photo === a.photo, `${JSON.stringify(a)}/${d.id}: the photo asked for`);
  }
  // The six the last step shows are built, for the answers that set something.
  if (a.place && a.photo) {
    for (const d of kept.slice(0, 6)) {
      await build(withAnswers(settingsOf(d), a), `${JSON.stringify(a)}/${d.id}`);
      opened++;
    }
  }
}
// ---- A pattern of long pieces reaches every side of the border, not only the widest: a row of
// scales crossing the face's edge is cut along it, never dropped (Ian, 2026-10-12: Scales 9 on
// Soft filled the top and bottom and left the sides bare).
for (const id of ['pm-scales-9', 'pm-waves-5', 'pm-scales-2', 'seigaiha', 'checkerboard']) {
  const s = { ...settingsOf(DESIGNS.find((d) => d.id === 'soft')!), patternOn: true, pattern: id };
  const L = frameLayout(specOf(s), printOf(s));
  const p = await patternInk(L, id, 1);
  withScope((keep) => {
    const onFace = keep(keep(csOf(wasm, p!.rings, 'Positive')).intersect(keep(csOf(wasm, p!.region, 'Positive'))));
    const w = L.window;
    const band = (x0: number, x1: number, y0: number, y1: number) =>
      keep(onFace.intersect(keep(keep(wasm.CrossSection.square([x1 - x0, y1 - y0])).translate([x0, y0])))).area();
    const side = { left: band(L.body.x0, w.cx - w.w / 2, w.cy - w.h / 2, w.cy + w.h / 2), right: band(w.cx + w.w / 2, L.body.x1, w.cy - w.h / 2, w.cy + w.h / 2), top: band(L.body.x0, L.body.x1, w.cy + w.h / 2, L.body.y1), bottom: band(L.body.x0, L.body.x1, L.body.y0, w.cy - w.h / 2) };
    for (const [name, a] of Object.entries(side)) check(a > 20, `${id} on Soft: the pattern reaches the ${name} side (${a.toFixed(0)} mm²)`);
  });
  // Moved, it still covers the face.
  const moved = await patternInk(L, id, 1, 3.5, -2);
  check(!!moved && moved.rings.length > 0, `${id} on Soft: moved 3.5, -2 mm it is still there`);
}

// ---- Magnets: only sizes and counts that fit the back plate are kept; four fit on a mini.
for (const d of DESIGNS.filter((x) => x.kind !== 'holder')) {
  for (const photo of ['mini', 'isq', 'iwide', '2x3', '3.5x5', '4x6', 'a6', 'custom'] as const) {
    for (const magnet of MAGNETS) {
      for (const magnetCount of ['2', '4'] as const) {
        const s = fitSettings({ ...settingsOf(d), photo, stand: 'magnets', magnet: magnet.id, magnetCount, customWidth: 30, customHeight: 40 }).settings;
        if (s.stand !== 'magnets') continue;
        check(magnetFits(magnetById(s.magnet), Number(s.magnetCount), s), `${d.id}/${photo}/${magnet.id}x${magnetCount}: the magnets kept fit`);
      }
    }
  }
}
{
  const mini = { ...settingsOf(DESIGNS.find((d) => d.id === 'soft')!), stand: 'magnets' as const };
  check(magnetCountsOffered(mini).join() === '2,4', 'Instant mini: 2 or 4 magnets');
  const four = magnetsOffered(mini, 4).map((m) => m.id);
  check(MAGNETS.filter((m) => m.d <= 12).every((m) => four.includes(m.id)), `Instant mini: every size up to 12 mm fits four times (${four.join(' ')})`);
  check(!four.includes('25x3'), 'Instant mini: four 25 mm magnets do not fit');
  for (const m of MAGNETS) {
    for (const count of ['2', '4'] as const) await build({ ...mini, magnet: m.id, magnetCount: count }, `soft on ${count} × ${m.id}`);
  }
}

// ---- Keychain: every loop position and the ends of the hole and border ranges build.
for (const loopAt of ['left', 'middle', 'right'] as const) {
  for (const [holeDia, holeRing] of [[3, 1.5], [5, 2.5], [8, 4]]) {
    await build({ ...settingsOf(DESIGNS.find((d) => d.id === 'charm')!), loopAt, holeDia: holeDia!, holeRing: holeRing! }, `charm loop ${loopAt} ${holeDia}/${holeRing}`);
  }
}

// ---- Every stock print turns: a turned instant print keeps the frame centred on its picture.
for (const d of DESIGNS) {
  for (const photo of ['mini', 'isq', 'iwide'] as const) {
    const natural = printOf({ photo, orientation: 'portrait', customWidth: 70, customHeight: 100 });
    const orientation = natural.pw < natural.ph ? ('landscape' as const) : ('portrait' as const);
    const s = fitSettings({ ...settingsOf(d), photo, orientation }).settings;
    if (s.photo !== photo) continue;
    const turned = printOf(s);
    check(turned.pw === natural.ph && turned.ph === natural.pw, `${d.id}/${photo} turned: the print lies the other way`);
    if (d.kind !== 'holder') {
      const L = frameLayout(specOf(s), turned);
      const mid = (L.body.x0 + L.body.x1) / 2;
      check(Math.abs(mid - L.window.cx) < 1e-6, `${d.id}/${photo} turned: the frame is centred on its picture`);
      check(L.body.x0 <= -turned.pw / 2 - L.rim + 1e-6 && L.body.x1 >= turned.pw / 2 + L.rim - 1e-6, `${d.id}/${photo} turned: a full border all round the print`);
    }
    await build(s, `${d.id}/${photo} turned`);
  }
}

// ---- Words: big by default, and never shrunk to the floor before there is room for them (Ian,
// 2026-10-12: words added to Soft came out 3.5 mm, the range having collapsed while it had none).
for (const d of DESIGNS.filter((x) => x.kind === 'frame' && settingsOf(x).outline !== 'squiggle')) {
  for (const orientation of ['portrait', 'landscape'] as const) {
    const bare = fitSettings({ ...settingsOf(d), wordsAt: 'none', orientation }).settings;
    check(textSizeMax(bare) > FIT.minEm + 4, `${d.id} ${orientation} with no words: the size has room (${textSizeMax(bare)})`);
    for (const wordsAt of ['bottom', 'top'] as const) {
      const words = fitSettings({ ...bare, wordsAt, words: { ...bare.words, caption: 'Mia' } }).settings;
      check(words.textSize >= 8, `${d.id} ${orientation}, words added at the ${wordsAt}: big letters (${words.textSize} mm)`);
      const L = frameLayout(specOf(words), printOf(words));
      const box = L.captions[0];
      const w = L.window;
      if (box) check(wordsAt === 'top' ? box.y0 >= w.cy + w.h / 2 : box.y1 <= w.cy - w.h / 2, `${d.id} ${orientation}: the words are ${wordsAt === 'top' ? 'over' : 'under'} the photo`);
      await build(words, `${d.id} ${orientation} words at the ${wordsAt}`);
    }
  }
}
{
  // A size set by hand stays; the room only bounds it.
  const s = fitSettings({ ...settingsOf(DESIGNS[0]!), textAuto: false, textSize: 6 }).settings;
  check(s.textSize === 6, 'a size set by hand is kept');
}

// ---- Kickstands: one in the middle, or two near the sides.
for (const id of ['classic', 'post', 'deco']) {
  const d = DESIGNS.find((x) => x.id === id)!;
  const plates = [];
  for (const kickstands of ['1', '2'] as const) {
    const s = fitSettings({ ...settingsOf(d), stand: 'kickstand', kickstands }).settings;
    const r = buildModel(wasm, { s: buildSettingsOf(s), ink: [], seed: 'photo-frame/test' });
    const plate = r.print.find((p) => p.name === 'Back plate')!;
    check(closed(plate.triVerts), `${id} on ${kickstands} kickstands: the plate is a closed mesh`);
    plates.push(plate.triVerts.length);
  }
  check(plates[1]! > plates[0]!, `${id}: two kickstands are two struts`);
}
check(kickstandsFor({ ...settingsOf(DESIGNS.find((d) => d.id === 'classic')!) }) === '2', 'a frame lying wide stands on two kickstands');
check(settingsOf(DESIGNS.find((d) => d.id === 'classic')!).kickstands === '2', 'Classic, lying wide, opens on two kickstands');
check(coerceSettings({ app: 'photo-frame', design: 'classic', photo: '4x6', orientation: 'landscape' })!.kickstands === '2', 'a file with no kickstands, lying wide: two');
check(coerceSettings({ app: 'photo-frame', design: 'classic', photo: '4x6', orientation: 'landscape', kickstands: '1' })!.kickstands === '1', 'a file that says one: one');
check(kickstandsFor({ ...settingsOf(DESIGNS[0]!) }) === '1', 'an upright frame stands on one');

// ---- The squiggle: even waves all round, and the back plate inside its band.
for (const photo of ['mini', 'isq', 'iwide', '2x3', '3.5x5', '4x6', 'a6'] as const) {
  for (const orientation of ['portrait', 'landscape'] as const) {
    const s = fitSettings({ ...settingsOf(DESIGNS.find((d) => d.id === 'squiggle')!), photo, orientation }).settings;
    const L = frameLayout(specOf(s), printOf(s));
    const r = outlineRecipe(L);
    withScope((keep) => {
      const centre = keep(csOf(wasm, r.band!.centre, 'Positive'));
      const outer = keep(centre.offset(r.band!.half, 'Round', 2, 12));
      const tail = Math.min(FIT.plateTail, L.body.x1 - L.Pw / 2 - 0.7);
      const py = L.Ph / 2 + FIT.groove - FIT.wingClear;
      const plate = keep(keep(wasm.CrossSection.square([L.Pw / 2 + tail - (-L.Pw / 2 + FIT.plateEnd), 2 * py])).translate([-L.Pw / 2 + FIT.plateEnd, -py]));
      const out = keep(plate.subtract(outer)).area();
      check(out < 1e-3, `squiggle ${photo} ${orientation}: the back plate stays inside the band (${out.toFixed(3)} mm² out)`);
    });
  }
}

const placeless = DESIGNS.filter((d: Design) => !PLACES.some((p) => takes(d, { place: p.id, photo: null })));
check(placeless.length === 0, `every design suits at least one place (${placeless.map((d) => d.id).join(', ')})`);
check(PHOTO_ANSWERS.length === 5, 'five photo answers');

console.log(`${checks - failures}/${checks} checks passed over ${builds} builds (${opened} from the walkthrough) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (failures) process.exit(1);
