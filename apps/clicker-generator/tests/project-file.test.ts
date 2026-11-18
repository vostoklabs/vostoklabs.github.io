/*
  The project file's own rules (src/settings.ts): what a loaded file's numbers are held to, what a
  value of the wrong type becomes, how a part-saved keyring, Model-mode cut or picture window
  memory is filled in, and that the controls read their ranges from the one table a load is held
  to. The file as Save writes it and Load reads it back is in tests/mount.scenarios.ts (the round
  trip, the old file, the wild values).

  Run from the repo root: node apps/clicker-generator/tests/suites.mjs project-file
*/
import { readFileSync } from 'node:fs';
import {
  ART_MM_MAX, coerceKeychain, coerceModelCut, coercePicture, coercePreprocess, coerceSettings, DEFAULT_KEYCHAIN,
  NOT_SAVED, PROJECT_FILE, PROJECT_VERSION, SAVED_SETTINGS, SETTING_LIMITS,
} from '../src/settings.ts';
import { DEFAULT_MODEL_CUT, MAX_BUTTONS } from '../src/model/types.ts';
import { DEFAULT_PREPROCESS } from '../../../packages/trace/src/types.ts';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  —  ${detail}` : ''}`);
  if (!ok) failures++;
};
const show = (v: unknown) => JSON.stringify(v);
const same = (a: unknown, b: unknown) => show(a) === show(b);

/* ---------------------------------------------------------------- the file's shape */

check('the file is still the clicker\'s version 3, recognised by version and settings',
  PROJECT_FILE.app === 'clicker-generator' && same(PROJECT_FILE.keys, ['version', 'settings']) && PROJECT_VERSION === 3);
check('no key is both saved and listed as not saved',
  !Object.keys(NOT_SAVED).some((k) => (SAVED_SETTINGS as readonly string[]).includes(k)));
check('each saved key is named once', new Set(SAVED_SETTINGS).size === SAVED_SETTINGS.length);

/* ---------------------------------------------------------------- numbers held to their range */

{
  const flat = Object.entries(SETTING_LIMITS).filter(([k]) => (SAVED_SETTINGS as readonly string[]).includes(k));
  const wrong: string[] = [];
  for (const [k, [lo, hi]] of flat) {
    const low = coerceSettings({ [k]: lo - 1000 })[k];
    const high = coerceSettings({ [k]: hi + 1000 })[k];
    const inside = coerceSettings({ [k]: (lo + hi) / 2 })[k];
    const mid = k === 'colorCount' ? Math.round((lo + hi) / 2) : (lo + hi) / 2;
    if (low !== lo || high !== hi || inside !== mid) wrong.push(`${k}: ${low} / ${inside} / ${high}`);
  }
  check('every limit holds both ends and keeps a value inside', wrong.length === 0, wrong.join(' | ') || `${flat.length} settings`);
  const strings = flat.filter(([k]) => k in coerceSettings({ [k]: '5' }));
  check('a string where a number goes is dropped, so the default applies', strings.length === 0, strings.map(([k]) => k).join(', '));
  check('a count is held whole', coerceSettings({ colorCount: 3.6 }).colorCount === 4);
  check('absent keys stay absent', Object.keys(coerceSettings({ capWidthMm: 40 })).join() === 'capWidthMm');
  check('an empty file, no settings or a list for settings read as none, and never throw',
    same(coerceSettings({}), {}) && same(coerceSettings(null), {}) && same(coerceSettings(undefined), {}) && same(coerceSettings([1, 2]), {}));
  check('keys this table does not know pass through (an old file\'s stemFitPct)', coerceSettings({ stemFitPct: 8 }).stemFitPct === 8);
}
{
  const c = coerceSettings({
    artMm: 9000, fixedSize: { w: 1, h: 500 }, importMode: 'video', colorMode: 'mapped', keychainEnd: 'middle',
    hollowBase: 'yes', removeBg: false, currentText: 7, packShapeToken: 3, imageOffset: { x: 'a', y: 0 },
    switches: [{ x: 1, y: 2 }, 'x', { x: 3, y: 4, rotation: 90 }, { x: 5, y: 6 }, { x: 7, y: 8 }],
    bodyColorRgb: [300, 0, 0], baseColorOverride: null, customColors: [[1, 2, 3], 'red', [1, 2]],
  });
  check('a held picture size is capped, and a locked size held to each side\'s range',
    c.artMm === ART_MM_MAX && same(c.fixedSize, { w: SETTING_LIMITS.fixedSizeMm[0], h: SETTING_LIMITS.fixedSizeMm[1] }), show([c.artMm, c.fixedSize]));
  check('a mode or a side the app does not have is dropped; one it has is kept',
    !('importMode' in c) && c.colorMode === 'mapped' && !('keychainEnd' in c));
  check('a switch that is not on/off, a text that is not text, a token that is not a name: dropped',
    !('hollowBase' in c) && c.removeBg === false && !('currentText' in c) && !('packShapeToken' in c));
  check('a nudge that is not two numbers is dropped', !('imageOffset' in c));
  check('the switches: only whole placements, at most three, a missing turn is 0',
    same(c.switches, [{ x: 1, y: 2, rotation: 0 }, { x: 3, y: 4, rotation: 90 }, { x: 5, y: 6, rotation: 0 }]), show(c.switches));
  check('colours: one out of range is dropped, no hand-picked cap colour stays none, a list keeps its colours',
    !('bodyColorRgb' in c) && c.baseColorOverride === null && same(c.customColors, [[1, 2, 3]]), show([c.bodyColorRgb, c.customColors]));
  check('a held size that is not a size is dropped; null (follows the shape) is kept',
    !('artMm' in coerceSettings({ artMm: -4 })) && coerceSettings({ artMm: null }).artMm === null);
}

/* ---------------------------------------------------------------- the keyring */

check('no keyring, or an old file\'s false: the default, off', same(coerceKeychain(undefined), DEFAULT_KEYCHAIN) && same(coerceKeychain(false), DEFAULT_KEYCHAIN));
check('an old file\'s true: the default loop, on', same(coerceKeychain(true), { ...DEFAULT_KEYCHAIN, enabled: true }));
{
  const k = coerceKeychain({ enabled: true, angleDeg: -90, holeDiameterMm: 40, offsetMm: -99, style: 'tunnel' });
  check('a keyring: the angle turned into 0..360, the hole and the offset held, an unknown style is a loop',
    same(k, { enabled: true, style: 'loop', angleDeg: 270, holeDiameterMm: SETTING_LIMITS.keychainHoleMm[1], offsetMm: SETTING_LIMITS.keychainOffsetMm[0] }), show(k));
  const h = coerceKeychain({ enabled: true, style: 'hole' });
  check('…a hole is kept, and what it lacks takes the default', h.style === 'hole' && h.angleDeg === 90 && h.holeDiameterMm === 5.2 && h.offsetMm === 0, show(h));
  // Placed first, cut on request: a hole saved before that has no flag, and opens cut.
  check('…a hole saved before holes were placed first has no cut flag, which builds it cut', !('holeCut' in h), show(h));
  const placed = coerceKeychain({ enabled: true, style: 'hole', holeCut: false });
  const cut = coerceKeychain({ enabled: true, style: 'hole', holeCut: true });
  const odd = coerceKeychain({ enabled: true, style: 'hole', holeCut: 'yes' });
  check('…a placed hole stays placed, a cut one cut, and a flag of the wrong type is dropped',
    placed.holeCut === false && cut.holeCut === true && !('holeCut' in odd), show([placed, cut, odd]));
}

/* ---------------------------------------------------------------- Model mode's cut */

check('no cut saved: the default cut', same(coerceModelCut(undefined), DEFAULT_MODEL_CUT));
{
  const c = coerceModelCut({ sizeMm: 50, button: { sizeMm: 20 }, slice: 'x', buttons: 40, more: Array.from({ length: 9 }, () => ({ x: 1, nudgeX: 'a' })) });
  check('part of a cut keeps the rest of each object\'s defaults',
    c.sizeMm === 50 && same(c.button, { ...DEFAULT_MODEL_CUT.button, sizeMm: 20 }) && same(c.slice, DEFAULT_MODEL_CUT.slice), show([c.button, c.slice]));
  check('the buttons are held to what one model can have', c.buttons === MAX_BUTTONS && c.more?.length === MAX_BUTTONS - 1, `${c.buttons} buttons, ${c.more?.length} more`);
  check('…and each extra button is whole: a place it lacks is the build\'s, a nudge it lacks is 0',
    same(c.more?.[0], { x: 1, y: null, nudgeX: 0, nudgeY: 0, rotation: 0 }), show(c.more?.[0]));
  check('a turn that is not three numbers is the default', same(coerceModelCut({ rotation: [90, 0] }).rotation, DEFAULT_MODEL_CUT.rotation));
  check('an old file\'s cut, before several buttons: one button', coerceModelCut({ cutter: 'button' }).buttons === 1);
}

/* ---------------------------------------------------------------- the picture window's memory */

check('no sliders saved: none', coercePreprocess(undefined) === null && coercePreprocess('x') === null);
{
  const fields = Object.keys(DEFAULT_PREPROCESS);
  const junk = Object.fromEntries(fields.map((k) => [k, 'junk']));
  check('every slider of the wrong type takes its default', same(coercePreprocess(junk), DEFAULT_PREPROCESS), show(coercePreprocess(junk)));
  const set = { cropRatio: '4:3', keepBackground: true, thicknessMm: 2, exposure: 1.1, contrast: 1.2, saturation: 0.9, brightness: 1.3, whiteBalance: 0.8, highlights: 0.7, shadows: 1.4 };
  check('every slider saved is read back', same(Object.keys(set).sort(), [...fields].sort()) && same(coercePreprocess(set), set), show(coercePreprocess(set)));
  check('a crop shape the window does not have is the default', coercePreprocess({ cropRatio: '5:1' })?.cropRatio === DEFAULT_PREPROCESS.cropRatio);
  const pic = coercePicture({ preprocess: { contrast: 2 }, source: 'javascript:alert(1)' });
  check('a saved picture that is not a picture is left out; its sliders are kept', pic?.source === null && pic?.preprocess?.contrast === 2, show(pic));
  check('no memory saved: none', coercePicture(null) === null && coercePicture(5) === null);
}

/* ---------------------------------------------------------------- one range, typed once */

{
  // The controls read their bounds from SETTING_LIMITS; these are the ones a slider or stepper shows.
  const ui = readFileSync('apps/clicker-generator/src/ui/ui.ts', 'utf8');
  const READ = ['capWidthMm', 'topThickness', 'imageDepth', 'capProud', 'tolerance', 'socketFitPct', 'smoothing', 'extrudeChamferMm',
    'lineSpacing', 'letterSpacing', 'textBold', 'textScale', 'keychainSlideMm', 'fixedSizeMm', 'keychainOffsetMm'];
  const typed = READ.filter((k) => !ui.includes(`SETTING_LIMITS.${k}[0]`) || !ui.includes(`SETTING_LIMITS.${k}[1]`));
  check('the rail\'s controls read their ranges from the table a load is held to', typed.length === 0, typed.join(', ') || `${READ.length} ranges`);
}

if (failures) {
  console.error(`\nproject-file: ${failures} failed`);
  process.exit(1);
}
console.log('\nproject-file: all passed');
