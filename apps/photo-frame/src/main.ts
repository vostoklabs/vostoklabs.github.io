import '@vostok/ui-kit/styles.css';
import '@vostok/plates/plates.css';
import '@vostok/fonts/fonts.css';
import './style.css';

import {
  appShell,
  applyTheme,
  resolveTheme,
  topbarLinks,
  generatorHeader,
  panelCredit,
  sidebarFooter,
  settingsRail,
  section,
  sliderRow,
  segmentedControl,
  selectField,
  setFieldOptions,
  filamentRow,
  fontChooser,
  symbolTextField,
  toggleSwitch,
  nudgePad,
  iconButton,
  button,
  buttonRow,
  previewBar,
  stageTools,
  stageRow,
  stageStatus,
  stagePanel,
  diagnosticsList,
  toast,
  dialog,
  licenseAfterExport,
  buildLoop,
  workerClient,
  syncControls,
  readProjectFile,
  markProject,
  ICONS,
  el,
  svgNode,
  type Diagnostic,
  type ProjectShape,
  type SymbolTextFieldHandle,
} from '@vostok/ui-kit';
import { openSymbolChooser } from '@vostok/ui-kit/symbols';
import { patternRow } from '@vostok/patterns/ui';
import { createViewer } from '@vostok/viewer';
import { mountPlatePicker, plateSize, loadPlateChoice, PLATES, plateLabel } from '@vostok/plates';
import { downloadThreeMF, downloadFile, exportPartOf } from '@vostok/export';
import { FONTS, toPickerFont, fontSupportsText, importFontFiles, iconByChar } from '@vostok/fonts';
import { outlinePath, symbolPath } from '@vostok/symbols';
import { FIT, type Border, type Corners, type HolderKind, type Outline, type Profile, type StandKind } from './geometry/layout';
import type { BuildRequest, BuildResult } from './geometry/build';
import { DESIGNS, PASTELS, designById, designOf, kickstandsFor, kindOf, settingsOf, type Design } from './designs';
import { cloneSettings, coerceSettings, WORD_ROLES, type FrameSettings, type WordRole, type Words } from './state';
import {
  HOLE_DIA,
  HOLE_RING,
  STAND_NAME,
  magnetCountsOffered,
  magnetsOffered,
  buildSettingsOf,
  fitSettings,
  maxLength,
  offersAddWords,
  patternOf,
  productOf,
  profileOf,
  standsOffered,
  takesPattern,
  textSizeMax,
  typed,
  wordRoles,
} from './rules';
import { NO_ANSWERS, standFor, type Answers } from './choose';
import { shrunkFirst, linesUnderFloor, type Ink } from './ink';
import { SEED, inkFor, pictureOf, sampleImage, standingParts, toViewer, type Shot } from './pictures';
import { outlineTile, profileTile } from './tiles';
import { CUSTOM_CAP, CUSTOM_MIN, MAGNETS, SIZES_FOR, article, naturalOrientation, photoById, type MagnetId, type Orientation, type PhotoId } from './sizes';
import type { LoopAt, WordsAt } from './settings';
import { fromTokens, tokenOf } from './text';
import { layoutOnPlate, type PlateLayout } from './plate';
import { createGallery, type Gallery } from './gallery';
import { openWalkthrough } from './walkthrough';
import { CHANGELOG } from './changelog';

/*
  Photo Frames Studio: frames, holders, a song plaque and a post for a print, from Instant mini to A5.

  Two screens and a hash: `#/` is the gallery of ready designs (gallery.ts), `#/t/<design>` the
  editor on one of them. The editor is ONE shell for the whole visit: opening a design applies its
  values through the one state path, `showSettings()`.

    LEFT    All designs, the design's name, and the rail: Size · Shape · Border · Pattern · Font ·
            Lettering · Stand · Colors. A category with nothing to show leaves the rail, and
            nothing is ever greyed.
    STAGE   the 3D model with a sample photo in it: standing, or laid out as it prints.
    RIGHT   only what is typed: the words the design asks for.

  The designs are designs.ts, the rules rules.ts, the walkthrough's choose.ts, the solids
  geometry/ (built in a worker).
*/

applyTheme(resolveTheme('photo-frame-theme'), 'photo-frame-theme');

// ---------------------------------------------------------------------------
// 1. STATE
// ---------------------------------------------------------------------------
let settings: FrameSettings = settingsOf(DESIGNS[0]!);

/** Words typed this visit, by role: they come along to the next design. */
const typedWords: Partial<Words> = {};
/** A photo size picked this visit (under Size, or in the walkthrough): it comes along too. */
let pickedSize: Partial<Pick<FrameSettings, 'photo' | 'orientation' | 'customWidth' | 'customHeight'>> = {};
/** The walkthrough's answers, while they stand. */
let answers: Answers = { ...NO_ANSWERS };
/** The tiles' pictures: when they are next painted, and for which settings they were. */
let paintTimer = 0;
let painted = '';

const PROJECT_FILE: ProjectShape = { app: 'photo-frame', keys: ['design', 'photo'] };

// ---------------------------------------------------------------------------
// 2. REBUILD: one build at a time in the worker; Download waits on it.
// ---------------------------------------------------------------------------
const worker = workerClient<BuildRequest, BuildResult>(() => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }));

interface Built {
  s: FrameSettings;
  result: BuildResult;
  /** The parts as they go on the chosen plate: exactly what the 3MF holds. */
  laid: PlateLayout;
  ink: Ink;
  photo: HTMLImageElement | null;
  diagnostics: Diagnostic[];
}

let refitNext = false;
let preview: 'assembled' | 'print' = 'assembled';
let lastShown: Built | null = null;

const loop = buildLoop<Built>({
  run: async () => {
    const s = cloneSettings(settings);
    const [ink, photo] = await Promise.all([inkFor(s), sampleImage(designOf(s).sample)]);
    const result = await worker.call({ s: buildSettingsOf(s), ink: ink.rings, pattern: ink.pattern, seed: SEED });
    const laid = layoutOnPlate(result.print, plateSize(loadPlateChoice()));
    return { s, result, laid, ink, photo, diagnostics: diagnose(s, laid, ink) };
  },
  debounceMs: 60,
  diagnose: (b) => b.diagnostics,
  onStart: () => status.set('Building…'),
  onResult: (b) => {
    lastShown = b;
    showModel(refitNext);
    refitNext = false;
    status.setDiagnostics(b.diagnostics, describe(b));
    // While there is a problem, the panel lists every one with its fix, in place of the hint;
    // the status line would only repeat the worst of them under it.
    const trouble = b.diagnostics.length > 0;
    problems.set(b.diagnostics);
    problemPanel.setOpen(trouble);
    hint.hidden = trouble;
    status.root.hidden = trouble;
    paintTiles();
  },
  onError: (err) => {
    problemPanel.setOpen(false);
    status.root.hidden = false;
    status.set(`Could not build the model: ${err.message}`, 'error');
  },
});

function triggerRebuild(refit = false) {
  if (refit) refitNext = true;
  loop.request();
}

function showModel(refit: boolean) {
  if (!lastShown) return;
  const flat = preview === 'print' && kindOf(lastShown.s) !== 'holder';
  viewer.setParts(flat ? lastShown.laid.parts.map(toViewer) : standingParts(lastShown.result, lastShown.photo), refit);
}

/** Problems that mean the file would not print: each is shown, and an error stops the export. */
function diagnose(s: FrameSettings, laid: PlateLayout, ink: Ink): Diagnostic[] {
  const out: Diagnostic[] = [];
  if (linesUnderFloor(ink).length) {
    out.push({ level: 'error', code: 'text-too-long', message: 'Text too long to print clearly: shorten it.', fix: 'Use fewer letters, or choose a narrower font.' });
  }
  const [pw, pd] = plateSize(loadPlateChoice());
  const plateName = plateLabel(loadPlateChoice()).replace(/^Plate:\s*/, '');
  const PART_NAME: Record<string, string> = { frame: 'frame', plate: 'back plate', base: 'base', holder: 'holder' };
  const fits = (w: number, d: number, u: [number, number]) => (w <= u[0] && d <= u[1]) || (w <= u[1] && d <= u[0]);
  for (const big of laid.tooBig) {
    const bigger = PLATES.find((p) => fits(big.w, big.d, [p.size[0] - 12, p.size[1] - 12]));
    out.push({
      level: 'error',
      code: 'part-over-plate',
      message: `The ${PART_NAME[big.group] ?? big.group} is ${Math.round(big.w)} × ${Math.round(big.d)} mm and the ${plateName} plate takes ${Math.round(pw - 12)} × ${Math.round(pd - 12)} mm.`,
      fix: bigger ? `Pick the ${bigger.name} plate, or a smaller photo size.` : 'Pick a smaller photo size.',
    });
  }
  if (!laid.tooBig.length && laid.plates > 1) {
    out.push({
      level: 'error',
      code: 'set-over-plate',
      message: `The parts need ${laid.plates} ${plateName} plates, and one file holds one plate.`,
      fix: s.stand === 'block' || s.stand === 'base' ? 'Pick another stand, a bigger plate, or a smaller photo size.' : 'Pick a bigger plate or a smaller photo size.',
    });
  }
  return out;
}

const mm = (v: number) => String(Math.round(v));

/** The status line: the size, what it holds, the parts and colours, what to buy, and what the
 *  engine changed. */
function describe(b: Built): string {
  const s = b.s;
  const r = b.result.report;
  const kind = kindOf(s);
  const seg: string[] = [`${mm(r.size[0])} × ${mm(r.size[1])} × ${r.size[2].toFixed(1)} mm`];
  const p = photoById(s.photo);
  if (s.photo === 'custom') seg.push(`Holds a ${mm(r.print[0])} × ${mm(r.print[1])} mm print`);
  else seg.push(`Holds ${article(p.name)} ${p.name} print`);
  if (r.parts > 1) seg.push(`${r.parts} parts`);
  if (r.colours > 1) seg.push(`${r.colours} colours`);
  if (r.magnets) seg.push(`${r.magnets.count} magnets, ${r.magnets.d} × ${r.magnets.h} mm, not included${r.magnets.weak ? ': a heavy frame for them, take 4 or bigger' : ''}`);
  if (kind !== 'holder' && s.stand === 'keychain') seg.push('Takes a key ring or ball chain, not included');
  if (patternOf(s) && !b.ink.pattern?.rings.length) seg.push('The pattern is too big for this border: make it smaller, or the border thicker');
  // A size the customer set and the words do not fit at is worth saying; one the engine picked
  // is made to fit by design.
  const shrunk = s.textAuto ? undefined : shrunkFirst(b.ink);
  if (shrunk) seg.push(`Text made smaller to fit: ${shrunk.text.em.toFixed(1)} mm`);
  // Words typed earlier that this design has no room for are kept, and said so.
  const shown = new Set(wordRoles(s));
  if (WORD_ROLES.some((role) => !shown.has(role) && typed(typedWords[role]))) seg.push('Your words are kept');
  return seg.join(' · ');
}

// ---------------------------------------------------------------------------
// 3. SETTINGS (left panel)
// ---------------------------------------------------------------------------
const sizeOptions = (s: FrameSettings) => SIZES_FOR[productOf(kindOf(s))].map((id) => ({ value: id, label: photoById(id).label }));

const OUTLINES: { value: Outline; label: string }[] = [
  { value: 'rect', label: 'Rectangle' },
  { value: 'arch', label: 'Arch' },
  { value: 'scallop', label: 'Scallop' },
  { value: 'ricrac', label: 'Ric-rac' },
  { value: 'squiggle', label: 'Squiggle' },
];
const HOLDERS: { value: HolderKind; label: string }[] = [
  { value: 'bar', label: 'Ledge' },
  { value: 'pill', label: 'Pebble' },
  { value: 'heart', label: 'Heart' },
];
const PROFILES: { value: Profile; label: string }[] = [
  { value: 'flat', label: 'Flat' },
  { value: 'bevel', label: 'Bevelled' },
  { value: 'deep', label: 'Deep' },
];
const STANDS: StandKind[] = ['block', 'base', 'foot', 'kickstand', 'magnets', 'keychain', 'none'];

/** A change to one setting: the rules, the controls, what shows, the build. */
function change(apply: () => void) {
  if (syncing) return;
  apply();
  showSettings();
}
let syncing = false;

const controls = {
  photo: selectField<PhotoId>({
    label: 'Photo size',
    options: sizeOptions(settings),
    value: settings.photo,
    onChange: (v) => change(() => {
      settings.photo = v;
      // An instant print comes the way it was shot: a mini standing, a wide lying down. The
      // customer turns it from there; a paper size keeps the way it was turned.
      if (photoById(v).film) settings.orientation = naturalOrientation(v);
      settings.kickstands = kickstandsFor(settings);
      pickedSize = { ...pickedSize, photo: v, orientation: settings.orientation };
      // A size picked here outranks the walkthrough's answer from then on.
      if (answers.photo) {
        answers = { ...answers, photo: null };
        gallery?.refresh();
      }
    }),
  }),
  orientation: segmentedControl<Orientation>({
    label: 'Orientation',
    options: [
      { value: 'portrait', label: 'Portrait' },
      { value: 'landscape', label: 'Landscape' },
    ],
    value: settings.orientation,
    onChange: (v) => change(() => {
      settings.orientation = v;
      settings.kickstands = kickstandsFor(settings);
      pickedSize = { ...pickedSize, orientation: v };
    }),
  }),
  customWidth: sliderRow({
    label: 'Photo width', min: CUSTOM_MIN, max: 210, step: 1, unit: 'mm', value: settings.customWidth,
    onInput: (v) => change(() => {
      settings.customWidth = v;
      pickedSize = { ...pickedSize, customWidth: v };
    }),
  }),
  customHeight: sliderRow({
    label: 'Photo height', min: CUSTOM_MIN, max: 210, step: 1, unit: 'mm', value: settings.customHeight,
    onInput: (v) => change(() => {
      settings.customHeight = v;
      pickedSize = { ...pickedSize, customHeight: v };
    }),
  }),
  outline: segmentedControl<Outline>({
    label: 'Outline',
    variant: 'tiles',
    options: OUTLINES,
    value: settings.outline,
    onChange: (v) => change(() => { settings.outline = v; }),
  }),
  holder: segmentedControl<HolderKind>({
    label: 'Holder',
    variant: 'tiles',
    columns: 3,
    size: 'compact',
    options: HOLDERS,
    value: settings.holder,
    onChange: (v) => change(() => { settings.holder = v; }),
  }),
  corners: segmentedControl<Corners>({
    label: 'Corners',
    options: [
      { value: 'square', label: 'Square' },
      { value: 'rounded', label: 'Soft' },
      { value: 'round', label: 'Round' },
    ],
    value: settings.corners,
    onChange: (v) => change(() => { settings.corners = v; }),
  }),
  crest: toggleSwitch({ label: 'Crest on top', checked: settings.crest, onChange: (v) => change(() => { settings.crest = v; }) }),
  border: segmentedControl<Border>({
    label: 'Border',
    options: [
      { value: 'thin', label: 'Thin' },
      { value: 'regular', label: 'Regular' },
      { value: 'thick', label: 'Thick' },
    ],
    value: settings.border,
    onChange: (v) => change(() => { settings.border = v; }),
  }),
  wordsAt: segmentedControl<WordsAt>({
    label: 'Room for words',
    options: [
      { value: 'none', label: 'None' },
      { value: 'top', label: 'Top' },
      { value: 'bottom', label: 'Bottom' },
    ],
    value: settings.wordsAt,
    onChange: (v) => change(() => { settings.wordsAt = v; }),
  }),
  profile: segmentedControl<Profile>({
    label: 'Profile',
    variant: 'tiles',
    columns: 3,
    size: 'compact',
    options: PROFILES.map((p) => ({ ...p, image: profileTile(p.value) })),
    value: settings.profile,
    onChange: (v) => change(() => { settings.profile = v; }),
  }),
  patternOn: toggleSwitch({ label: 'Pattern', checked: settings.patternOn, onChange: (v) => change(() => { settings.patternOn = v; }) }),
  patternSize: sliderRow({
    label: 'Pattern size', min: 50, max: 200, step: 5, unit: '%', value: settings.patternSize,
    onInput: (v) => {
      if (syncing) return;
      settings.patternSize = v;
      triggerRebuild();
    },
  }),
  textSize: sliderRow({
    label: 'Text size', min: FIT.minEm, max: 14, step: 0.5, unit: 'mm', value: settings.textSize,
    onInput: (v) => {
      if (syncing) return;
      // Set by hand, it stays: the size no longer follows the room.
      settings.textSize = v;
      settings.textAuto = false;
      triggerRebuild();
    },
  }),
  stand: segmentedControl<StandKind>({
    label: 'Stand, stick or hang',
    variant: 'tiles',
    options: STANDS.map((value) => ({ value, label: STAND_NAME[value] })),
    value: settings.stand,
    onChange: (v) => change(() => { settings.stand = v; }),
  }),
  kickstands: segmentedControl<'1' | '2'>({
    label: 'Kickstands',
    options: [
      { value: '1', label: '1' },
      { value: '2', label: '2' },
    ],
    value: settings.kickstands,
    onChange: (v) => change(() => { settings.kickstands = v; }),
  }),
  magnetCount: segmentedControl<'2' | '4'>({
    label: 'Magnets',
    options: [
      { value: '2', label: '2' },
      { value: '4', label: '4' },
    ],
    value: settings.magnetCount,
    onChange: (v) => change(() => { settings.magnetCount = v; }),
  }),
  magnet: selectField<MagnetId>({
    label: 'Magnet size',
    options: MAGNETS.map((m) => ({ value: m.id, label: m.label })),
    value: settings.magnet,
    onChange: (v) => change(() => { settings.magnet = v; }),
  }),
  loopAt: segmentedControl<LoopAt>({
    label: 'Loop',
    options: [
      { value: 'left', label: 'Left' },
      { value: 'middle', label: 'Middle' },
      { value: 'right', label: 'Right' },
    ],
    value: settings.loopAt,
    onChange: (v) => change(() => { settings.loopAt = v; }),
  }),
  holeDia: sliderRow({
    label: 'Hole size', min: HOLE_DIA[0], max: HOLE_DIA[1], step: 0.5, unit: 'mm', value: settings.holeDia,
    help: '4 mm for a jump ring, 5 mm for a split ring.',
    onInput: (v) => {
      if (syncing) return;
      settings.holeDia = v;
      triggerRebuild();
    },
  }),
  holeRing: sliderRow({
    label: 'Hole border', min: HOLE_RING[0], max: HOLE_RING[1], step: 0.5, unit: 'mm', value: settings.holeRing,
    help: 'Plastic round the hole: more holds better.',
    onInput: (v) => {
      if (syncing) return;
      settings.holeRing = v;
      triggerRebuild();
    },
  }),
  bodyColor: filamentRow({
    label: 'Frame', labelId: 'pf-body-label', value: settings.bodyColor, extra: PASTELS,
    onChange: (hex) => change(() => {
      // The base follows the frame while the two match; once it differs, it stays.
      if (settings.baseColor.toLowerCase() === settings.bodyColor.toLowerCase()) settings.baseColor = hex;
      settings.bodyColor = hex;
    }),
  }),
  inkColor: filamentRow({
    label: 'Text', labelId: 'pf-ink-label', value: settings.inkColor, extra: PASTELS,
    onChange: (hex) => {
      if (syncing) return;
      settings.inkColor = hex;
      triggerRebuild();
    },
  }),
  matColor: filamentRow({
    label: 'Mat', value: settings.matColor, extra: PASTELS,
    onChange: (hex) => {
      if (syncing) return;
      settings.matColor = hex;
      triggerRebuild();
    },
  }),
  baseColor: filamentRow({
    label: 'Base', value: settings.baseColor, extra: PASTELS,
    onChange: (hex) => {
      if (syncing) return;
      settings.baseColor = hex;
      triggerRebuild();
    },
  }),
};

/** The pattern: the shelf's card with Choose pattern… and Surprise me. Not a value row, so
 *  `showSettings()` syncs it by hand. */
const pattern = patternRow({
  value: settings.pattern,
  onPick: (id) => {
    settings.pattern = id;
    triggerRebuild();
  },
});

/** The pattern moved a little, the way a keycap's legend is: arrows and two numbers. Not one
 *  setting but two, so `showSettings()` syncs it by hand. */
const patternMove = nudgePad({
  label: 'Move the pattern',
  step: 0.5,
  x: { label: 'X', value: settings.patternDx, max: 20 },
  y: { label: 'Y', value: settings.patternDy, max: 20 },
  onChange: (x, y) => {
    if (syncing) return;
    settings.patternDx = x;
    settings.patternDy = y;
    triggerRebuild();
  },
});

/** The faces shown as cards: the ones the designs use, all bold enough to print as an inlay. */
const FONT_CARDS = ['fredoka', 'baloo-2', 'montserrat', 'poppins', 'nunito', 'dancing-script', 'courgette', 'bebas-neue'];
const firstLine = () => wordRoles(settings).map((r) => settings.words[r]).find(typed) ?? '';
const sampleOf = (text: string) => fromTokens(text).replace(/[\u{e000}-\u{f8ff}]/gu, '').trim().slice(0, 12) || 'Abc';

const fonts = fontChooser({
  fonts: FONTS.map(toPickerFont),
  curated: FONT_CARDS.filter((id) => FONTS.some((f) => f.id === id)),
  featuredLabel: 'Good on a frame',
  value: settings.font,
  sample: sampleOf(firstLine()),
  checkText: fromTokens(firstLine()),
  fill: true,
  supports: (f, text) => fontSupportsText(f.id, text.replace(/[\u{e000}-\u{f8ff}]/gu, '')),
  onChange: (id) => {
    if (syncing) return;
    settings.font = id;
    triggerRebuild();
  },
  onImport: async (file) => {
    const { fonts: imported, failed } = await importFontFiles(file);
    return { fonts: imported.map(toPickerFont), failed };
  },
});

const showSample = () => fonts.setSample(sampleOf(firstLine()), fromTokens(firstLine()));

const rail = settingsRail({
  label: 'Frame settings',
  flush: true,
  items: [
    { id: 'size', label: 'Size', title: 'Photo size', icon: ICONS.dimensions, body: [controls.photo, controls.orientation, controls.customWidth, controls.customHeight] },
    { id: 'shape', label: 'Shape', icon: ICONS.heart, body: [controls.outline, controls.holder, controls.corners, controls.crest] },
    { id: 'border', label: 'Border', icon: ICONS.frame, body: [controls.border, controls.wordsAt, controls.profile] },
    { id: 'pattern', label: 'Pattern', icon: ICONS.pattern, body: [controls.patternOn, pattern.root, controls.patternSize, patternMove] },
    { id: 'font', label: 'Font', icon: ICONS.text, fill: true, body: [fonts] },
    { id: 'lettering', label: 'Lettering', icon: ICONS.lettering, body: [controls.textSize] },
    { id: 'stand', label: 'Stand', title: '', icon: ICONS.stand, body: [controls.stand, controls.kickstands, controls.magnetCount, controls.magnet, controls.loopAt, controls.holeDia, controls.holeRing] },
    { id: 'colors', label: 'Colors', icon: ICONS.droplet, body: [controls.bodyColor, controls.inkColor, controls.matColor, controls.baseColor] },
  ],
  onChange: () => paintTiles(),
});

/** Hide what does not apply, never grey it, and name the colour rows for what they colour. */
function applyVisibility() {
  const s = settings;
  const kind = kindOf(s);
  const frame = kind === 'frame';
  const p = photoById(s.photo);
  // Every stock print turns; a Custom size is typed the way it stands.
  controls.orientation.hidden = s.photo === 'custom';
  controls.customWidth.hidden = s.photo !== 'custom';
  controls.customHeight.hidden = s.photo !== 'custom';

  controls.outline.hidden = !frame;
  controls.holder.hidden = kind !== 'holder';
  controls.corners.hidden = !(kind === 'song' || kind === 'post' || (frame && s.outline === 'rect'));
  controls.crest.hidden = !(frame && s.outline === 'rect');

  controls.border.hidden = !frame || s.outline === 'squiggle';
  controls.wordsAt.hidden = !frame || s.outline === 'squiggle';
  controls.profile.hidden = !(frame && s.outline === 'rect');

  const patternShown = takesPattern(s);
  controls.patternOn.hidden = !patternShown;
  pattern.root.hidden = !patternOf(s);
  controls.patternSize.hidden = !patternOf(s);
  patternMove.hidden = !patternOf(s);

  const roles = wordRoles(s);
  fonts.hidden = roles.length === 0;
  controls.textSize.hidden = !roles.some((r) => r === 'caption' || r === 'song' || r === 'front');

  controls.stand.hidden = kind === 'holder';
  const magnets = kind !== 'holder' && s.stand === 'magnets';
  const keychain = kind !== 'holder' && s.stand === 'keychain';
  controls.kickstands.hidden = !(kind !== 'holder' && s.stand === 'kickstand');
  controls.magnetCount.hidden = !magnets;
  controls.magnet.hidden = !magnets;
  controls.loopAt.hidden = !keychain;
  controls.holeDia.hidden = !keychain;
  controls.holeRing.hidden = !keychain;
  const offered = standsOffered(s);
  for (const st of STANDS) controls.stand.setOptionVisible(st, offered.includes(st));

  // The second colour, named for what it colours.
  const words = roles.some((r) => typed(s.words[r]));
  const ricrac = frame && s.outline === 'ricrac';
  let ink = '';
  if (kind === 'song') ink = 'Text and player';
  else if (kind === 'post') ink = 'Text and icons';
  else if (ricrac) ink = words ? 'Band and text' : 'Band';
  else if (patternOf(s)) ink = words ? 'Text and pattern' : 'Pattern';
  else if (words) ink = 'Text';
  controls.inkColor.hidden = ink === '';
  setText('pf-ink-label', ink);
  setText('pf-body-label', kind === 'holder' ? 'Holder' : 'Frame');
  controls.matColor.hidden = profileOf(s) !== 'deep';
  controls.baseColor.hidden = kind === 'holder' || !(s.stand === 'block' || s.stand === 'base');

  // The right panel: the fields this design asks for, or Add words.
  for (const role of WORD_ROLES) fields[role].hidden = !roles.includes(role);
  textSection.hidden = roles.length === 0;
  addWords.hidden = !offersAddWords(s);
  viewBar.root.hidden = kind === 'holder';
  rail.refresh();
}

function setText(id: string, text: string) {
  const node = document.getElementById(id);
  if (node) node.textContent = text;
}

/**
 * The one path every change goes through that is not a single control's own value: opening a
 * design, Load, Reset, a new photo size, a new outline. Rules first, then the lists and ranges,
 * then the controls, then what shows, then the build.
 */
function showSettings(refit = false) {
  const { settings: fitted, notices } = fitSettings(settings);
  settings = fitted;
  for (const n of notices) toast(n.text, { kind: n.kind });
  syncing = true;
  try {
    setFieldOptions(controls.photo, sizeOptions(settings), settings.photo);
    const [short, long] = CUSTOM_CAP[productOf(kindOf(settings))];
    controls.customWidth.setBounds(CUSTOM_MIN, settings.customHeight <= short ? long : short);
    controls.customHeight.setBounds(CUSTOM_MIN, settings.customWidth <= short ? long : short);
    controls.textSize.setBounds(FIT.minEm, Math.max(FIT.minEm, textSizeMax(settings)));
    // Only the stands this design and print take are offered; the value is one of them.
    const offered = standsOffered(settings);
    for (const st of STANDS) controls.stand.setOptionVisible(st, offered.includes(st));
    // …and only the magnets its back plate takes.
    controls.magnetCount.setOptionVisible('4', magnetCountsOffered(settings).includes('4'));
    setFieldOptions(controls.magnet, magnetsOffered(settings, Number(settings.magnetCount)).map((m) => ({ value: m.id, label: m.label })), settings.magnet);
    const { words, ...values } = settings;
    syncControls(values, controls);
    Object.assign(settings, values, { words });
    pattern.set(settings.pattern);
    patternMove.setValue({ x: settings.patternDx, y: settings.patternDy });
    fonts.setValue(settings.font);
    settings.font = fonts.getValue();
    for (const role of WORD_ROLES) {
      fields[role].setValue(settings.words[role]);
      fields[role].setMaxLength(maxLength(role, settings));
    }
    showCounts();
  } finally {
    syncing = false;
  }
  showSample();
  applyVisibility();
  triggerRebuild(refit);
}

// ---------------------------------------------------------------------------
// 4. WHAT THE CUSTOMER TYPES (right panel)
// ---------------------------------------------------------------------------
/** The drawing of each symbol in a field, by its token. */
const symbolArt = new Map<string, string>();

function renderSymbol(ch: string): Element | null {
  const d = symbolArt.get(ch);
  if (d) return svgNode('svg', { viewBox: '-0.55 -0.55 1.1 1.1', 'aria-hidden': 'true', focusable: 'false' }, [svgNode('path', { d, fill: 'currentColor' })]);
  const icon = iconByChar(fromTokens(ch));
  if (icon) {
    symbolPath(`material:${icon.id}`)
      .then((path) => {
        symbolArt.set(ch, path);
        for (const role of WORD_ROLES) fields[role].repaint();
      })
      .catch(() => undefined);
  }
  return null;
}

const FIELD: Record<WordRole, { label: string; placeholder: string; symbols: boolean }> = {
  caption: { label: 'Caption', placeholder: 'Type a caption', symbols: true },
  second: { label: 'Second line', placeholder: 'A date or a name', symbols: true },
  initials: { label: 'Initials', placeholder: 'M & L', symbols: true },
  song: { label: 'Song', placeholder: 'Song title', symbols: true },
  artist: { label: 'Artist', placeholder: "Who it's by", symbols: true },
  length: { label: 'Length', placeholder: '3:45', symbols: false },
  handle: { label: 'Name', placeholder: 'your.name', symbols: true },
  likes: { label: 'Likes', placeholder: '249 likes', symbols: true },
  postCaption: { label: 'Caption', placeholder: 'Write a caption', symbols: true },
  front: { label: 'Text on the front', placeholder: 'A name or a date', symbols: true },
};

function fieldFor(role: WordRole, label: string, placeholder: string): SymbolTextFieldHandle {
  let field: SymbolTextFieldHandle;
  const add: HTMLElement | undefined = FIELD[role].symbols
    ? iconButton({
        icon: ICONS.plus,
        label: 'Add symbol',
        emphasis: 'secondary',
        onClick: () =>
          openSymbolChooser({
            sets: ['material'],
            title: 'Add a symbol',
            anchor: add!,
            onPick: (choice) => {
              if (!choice.char) return;
              const token = tokenOf(choice.char);
              symbolArt.set(token, outlinePath(choice.shapes));
              if (!field.insertAtCaret(token)) toast('This line is full. Take a letter out to make room for a symbol.', { kind: 'warn' });
            },
          }),
      })
    : undefined;
  field = symbolTextField({
    label,
    placeholder,
    value: settings.words[role],
    maxLength: maxLength(role, settings),
    action: add,
    renderSymbol,
    symbolLabel: (ch) => iconByChar(fromTokens(ch))?.label ?? 'Symbol',
    onInput: (v) => {
      settings.words[role] = v;
      typedWords[role] = v;
      showCounts();
      showSample();
      applyVisibility();
      triggerRebuild();
    },
  });
  return field;
}

let fields!: Record<WordRole, SymbolTextFieldHandle>;

/** The fields, named the way this design names them (the Wedding's Names and Date). */
function makeFields(d: Design): Record<WordRole, SymbolTextFieldHandle> {
  const out = {} as Record<WordRole, SymbolTextFieldHandle>;
  for (const role of WORD_ROLES) {
    const named = d.labels?.[role];
    out[role] = fieldFor(role, named?.label ?? FIELD[role].label, named?.placeholder ?? FIELD[role].placeholder);
  }
  return out;
}

/** A count inside a long field from four characters before its limit. A short one (initials, a
 *  length) says nothing: its limit is plain from what it is for. */
function showCounts() {
  for (const role of WORD_ROLES) {
    const limit = maxLength(role, settings);
    const n = [...settings.words[role]].length;
    fields[role].setHint(limit >= 12 && n >= limit - 4 ? `${n}/${limit}` : '');
  }
}

const SECTION_TITLE: Partial<Record<string, string>> = { song: 'Song', post: 'Post' };
const textSlot = el('div', { className: 'pf-words' });
let textSection!: HTMLElement;

/** "Add words": a wide bottom with room for a caption, the caret in it. */
const addWords = button({
  label: 'Add words',
  icon: ICONS.plus,
  emphasis: 'ghost',
  onClick: () => {
    settings.wordsAt = 'bottom';
    showSettings();
    fields.caption.focus();
  },
});

function placeFields(d: Design) {
  fields = makeFields(d);
  textSection = section({ title: SECTION_TITLE[d.kind] ?? 'Text', body: WORD_ROLES.map((r) => fields[r]) });
  textSlot.replaceChildren(textSection, buttonRow(addWords));
}

// ---------------------------------------------------------------------------
// 5. PICTURES ON THE TILES: the outline drawn flat in the frame's colour with the sample photo;
//    the holders and stands rendered from the real builds, of the design on screen.
// ---------------------------------------------------------------------------
const TILE: Shot = { width: 240, height: 200 };
const STAND_SHOT: Partial<Record<StandKind, Shot['from']>> = { foot: 'side', kickstand: 'side', magnets: 'back' };

function paintTiles() {
  clearTimeout(paintTimer);
  paintTimer = window.setTimeout(() => {
    const open = rail.getValue();
    const s = cloneSettings(settings);
    const key = JSON.stringify([open, s]);
    if (key === painted) return;
    painted = key;
    if (open === 'shape' && kindOf(s) === 'frame') {
      for (const o of OUTLINES) void outlineTile(s, o.value).then((url) => controls.outline.setOptionImage(o.value, url));
    }
    if (open === 'shape' && kindOf(s) === 'holder') {
      for (const h of HOLDERS) void pictureOf({ ...s, holder: h.value }, TILE).then((url) => url && controls.holder.setOptionImage(h.value, url));
    }
    if (open === 'stand' && kindOf(s) !== 'holder') {
      for (const st of standsOffered(s)) {
        void pictureOf({ ...s, stand: st }, { ...TILE, from: STAND_SHOT[st] ?? 'front' }).then((url) => url && controls.stand.setOptionImage(st, url));
      }
    }
  }, 250);
}

// ---------------------------------------------------------------------------
// 6. CHROME
// ---------------------------------------------------------------------------
const back = button({ label: 'All designs', icon: ICONS.arrowLeft, emphasis: 'ghost', onClick: () => { location.hash = '#/'; } });
const titleSlot = el('div', { className: 'pf-design-title' });

const reset = button({
  label: 'Reset this design',
  icon: ICONS.rotateLeft,
  emphasis: 'ghost',
  onClick: () => {
    // Back to how the design opened; the words are the customer's and stay.
    const words = { ...settings.words };
    settings = opening(designOf(settings));
    settings.words = words;
    showSettings(true);
    toast('Design reset', { kind: 'ok' });
  },
});

const footer = sidebarFooter({
  formats: [{ id: '3mf', label: '3MF' }],
  onExport: async (format) => {
    if (format !== '3mf') throw new Error('Unknown format: ' + format);
    // The build that matches the screen; refused, in the problem's own words, while one stands.
    const built = await loop.settled();
    downloadThreeMF(
      built.laid.parts.map((p) => exportPartOf(p, { name: p.name, color: p.color, group: p.group })),
      {
        title: 'Photo Frames Studio',
        generator: 'photo-frame',
        application: 'Vostok Labs Photo Frames Studio',
        buildId: import.meta.env.VITE_BUILD_ID,
        plateSize: plateSize(loadPlateChoice()),
      },
      `photo-frame-${built.s.design}.3mf`,
    );
    licenseAfterExport();
  },
  onSave: () => downloadFile(JSON.stringify(markProject(PROJECT_FILE, settings), null, 2), `photo-frame-${settings.design}.json`, 'application/json'),
  onLoad: (file?: File) =>
    file &&
    readProjectFile(
      file,
      (data) => {
        const loaded = coerceSettings(data);
        if (!loaded) return void toast('This project is for a design this app does not have.', { kind: 'warn' });
        const d = designOf(loaded);
        if (location.hash !== `#/t/${d.id}`) history.replaceState(null, '', `#/t/${d.id}`);
        show(editorRoot);
        showDesign(d, loaded);
        toast('Project loaded', { kind: 'ok' });
      },
      PROJECT_FILE,
    ),
  onHelp: () =>
    dialog({
      title: 'Photo Frames Studio help',
      content: el('div', {}, [
        el('p', { text: 'Pick a design, type your words on the right, and press Download 3MF. Everything the design set can be changed on the left.' }),
        el('p', { text: 'The plus button beside a line adds a symbol. On a Song, the symbol at the end of the title is the player’s like button.' }),
        el('p', { text: 'Under Stand, pick how it stands, sticks or hangs. The line under the model says what to buy, such as magnets or a key ring.' }),
        el('p', { text: 'The photo in the preview is only a sample: it is never in the file. Print with a 0.4 mm nozzle, 0.2 mm layers and PLA, no supports.' }),
        el('p', { text: 'To put a frame together, slide the back plate out to the right, lay the photo in from the back, and slide the plate back in.' }),
      ]),
      actions: [{ label: 'Got it', primary: true }],
    }),
  themeStorageKey: 'photo-frame-theme',
});

// ---------------------------------------------------------------------------
// 7. STAGE
// ---------------------------------------------------------------------------
const status = stageStatus('Building…');
const stageCanvas = el('div', { className: 'pf-stage-canvas' });

const viewBar = previewBar<'assembled' | 'print'>({
  label: 'View',
  modes: {
    label: 'View',
    options: [
      { value: 'assembled', label: 'Assembled' },
      { value: 'print', label: 'Print layout' },
    ],
    value: preview,
    onChange: (v) => {
      preview = v;
      // A different scene, not a different value: frame it afresh.
      showModel(true);
    },
  },
});

const hint = el('p', { className: 'vl-stage__hint', text: 'Hold left click to rotate, right click to pan, scroll to zoom.' });
const problems = diagnosticsList();
const problemPanel = stagePanel({ title: 'What to fix', body: [problems.root] });

// ---------------------------------------------------------------------------
// 8. ASSEMBLE
// ---------------------------------------------------------------------------
placeFields(DESIGNS[0]!);

const shell = appShell({
  topbar: topbarLinks({ themeToggle: false }),
  phone: true,
  // On a phone the left panel is behind Settings: the way back and the design's name stay out.
  phoneKeep: [back, titleSlot],
  left: {
    compact: true,
    header: [back, titleSlot],
    scroll: [rail],
    footer: [buttonRow(reset)],
    credit: panelCredit({ title: 'Photo Frames Studio', updates: { entries: CHANGELOG, title: 'Updates' } }),
  },
  stage: [stageCanvas, stageTools([stageRow([viewBar.root])]), status.root, hint, problemPanel.root],
  right: {
    scroll: [textSlot],
    footer: [footer],
  },
});
const editorRoot = shell.root;
editorRoot.classList.add('pf-editor');

const viewer = createViewer(stageCanvas, { frame: { fill: 0.6 }, alpha: true });
mountPlatePicker(shell.stage, viewer, () => triggerRebuild());

/** A design as it opens now: its own values, the photo size and words this visit carries, and the
 *  stand the walkthrough's place asks for. */
function opening(d: Design): FrameSettings {
  const s = settingsOf(d);
  Object.assign(s, pickedSize);
  if (answers.photo && answers.photo !== 'other') {
    s.photo = answers.photo;
    if (photoById(s.photo).film && !pickedSize.orientation) s.orientation = naturalOrientation(s.photo);
  }
  for (const role of WORD_ROLES) {
    const words = typedWords[role];
    if (words !== undefined) s.words[role] = words;
  }
  s.stand = standFor(s, answers.place);
  s.kickstands = kickstandsFor(s);
  return s;
}

function showDesign(d: Design, s: FrameSettings) {
  editing = d.id;
  settings = s;
  titleSlot.replaceChildren(generatorHeader({ title: d.name, description: d.line, hideCredit: true, compact: true }));
  document.title = `${d.name} · Photo Frames Studio · Vostok Labs`;
  placeFields(d);
  painted = '';
  rail.open('size');
  showSettings(true);
}

// ---------------------------------------------------------------------------
// 9. TWO SCREENS: the gallery at #/, the editor at #/t/<design>.
// ---------------------------------------------------------------------------
const app = document.getElementById('app')!;
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
let gallery: Gallery | null = null;
let galleryScroll = 0;
/** The design the editor holds. Back to the gallery and into the same design again finds it as
 *  it was left; another design opens fresh. */
let editing: string | null = null;

function show(node: HTMLElement, scrollY = 0) {
  if (app.firstElementChild === node) return;
  if (gallery && app.firstElementChild === gallery.root) galleryScroll = window.scrollY;
  app.replaceChildren(node);
  window.scrollTo(0, scrollY);
}

function setAnswers(next: Answers) {
  answers = next;
  gallery?.refresh();
}

function openGallery(): Gallery {
  gallery ??= createGallery({
    onPick: (d) => { location.hash = `#/t/${d.id}`; },
    onHelp: () =>
      openWalkthrough({
        start: answers,
        onOpen: (d, a) => {
          setAnswers(a);
          // Opened from the walkthrough, a design takes its answers, even the one last edited.
          editing = null;
          location.hash = `#/t/${d.id}`;
        },
        onSeeAll: (a) => setAnswers(a),
      }),
    getAnswers: () => answers,
    setAnswers,
  });
  return gallery;
}

function route() {
  const m = /^#\/t\/([\w-]+)/.exec(location.hash);
  const d = m ? designById(m[1]!) : undefined;
  if (!d) {
    if (location.hash && location.hash !== '#/') history.replaceState(null, '', '#/');
    document.title = 'Photo Frames Studio · Vostok Labs';
    show(openGallery().root, galleryScroll);
    return;
  }
  show(editorRoot);
  if (editing !== d.id) showDesign(d, opening(d));
  else document.title = `${d.name} · Photo Frames Studio · Vostok Labs`;
}

window.addEventListener('hashchange', route);
route();
