/*
  The clicker's project file: what a saved project holds, and how a loaded one is read back.

  Pure (no DOM, no store), so the node suites can test it on its own.

  Two lists account for every field of `UiState`: `SAVED_SETTINGS` (written under `settings` by
  `buildProject` in mount.ts, read back by `applyProject`) and `NOT_SAVED` (screen, viewport or
  worked-out state, each with its reason). A `UiState` field in neither list, or in both, stops
  `tsc`. `buildProject` writes its `settings` object against `SAVED_SETTINGS`, so a key written
  but not listed, or listed but not written, stops `tsc` too.

  A file from outside is read through `coerceSettings` first: each number with one fixed range
  held to the range its control offers (`SETTING_LIMITS`, which the controls read), anything of
  the wrong type dropped, so the `?? default` of `applyProject` applies. Absent keys stay absent:
  that is how a file saved before a setting existed opens with the setting's default. Numbers
  whose range depends on the design are not held to a range here: the shape's
  knobs (the build holds them to the shape's range), where the switches sit (the build holds
  them in its box), the picture's offset, the edges, the part heights and the Model cut's sizes.
  Only a hand-edited file reaches them out of range.
*/
import type { ProjectShape } from '@vostok/ui-kit';
import type { UiState } from './ui/ui';
import type { KeychainParams, KeychainSide, PreprocessParams, RGB } from './types';
import { DEFAULT_PREPROCESS } from './types';
import { STEM_FIT_MAX_MM, STEM_FIT_MIN_MM, STEM_OUTER_MAX_MM, STEM_OUTER_MIN_MM } from './geometry/stemFit';
import { DESIGN_SCALE_MAX, DESIGN_SCALE_MIN, TEXT_SCALE_MIN } from './geometry/sizeLimits';
import { buttonCount, DEFAULT_MODEL_CUT, MAX_BUTTONS, type ExtraButton, type ModelCutParams } from './model/types';

/** A clicker project file: every one saved carries `version` and `settings` (see
 *  `buildProject`), so a file without them, or one another app saved, is refused on Load. */
export const PROJECT_FILE: ProjectShape = { app: 'clicker-generator', keys: ['version', 'settings'] };

/** Written into every file and never read: each field's `?? default` is what keeps old files
 *  opening, so the number has not had to change. */
export const PROJECT_VERSION = 3;

/** Every key `buildProject` writes under `settings`, in the order it writes them. Most are
 *  `UiState` fields; the rest are held outside the store (the text, the font, the SVG and icon
 *  sources, the picture's name) or saved in another form (`drawnShapeRings`). */
export const SAVED_SETTINGS = [
  'colorCount', 'baseShape', 'capWidthMm', 'topThickness', 'imageDepth', 'capProud', 'hollowBase',
  'fixedSize', 'designScale', 'artMm', 'designRotation', 'shapeSides', 'shapeCornerPct',
  'shapeArmPct', 'packShapeToken', 'drawnShapeRings', 'tolerance', 'stemFitMm', 'stemOuterMm',
  'socketFitPct', 'imageOffset', 'switches', 'keychain', 'smoothing', 'removeBg', 'importMode',
  'currentText', 'textSymbols', 'currentFontId', 'currentSvgText', 'currentSvgOptions',
  'currentSvgName', 'currentIconText', 'currentIconName', 'currentImageName', 'colorMode',
  'limitedColors', 'mappedColors', 'mappedFilaments', 'pictureEdits', 'pictureCrop',
  'bottomPicture', 'bodyColorRgb', 'paletteOverrides', 'baseColorOverride', 'partOverrides',
  'customColors', 'edgeSettings', 'extrudeChamferMm', 'separateLetters', 'lineSpacing',
  'letterSpacing', 'textBold', 'textScale', 'componentHeights', 'colourLevels', 'words',
  'wordsColorRgb', 'wordsLevel', 'blank', 'blockLayout', 'blockGridRows', 'blockGridCols',
  'blockCells', 'blockLines', 'blockSymbols', 'blockStyle', 'blockTexture', 'blockRimRaiseMm',
  'blockKeycap', 'blockCapLowerMm', 'legendScale', 'legendBold', 'keychainEnd', 'keychainSlideMm',
  'modelCut',
] as const;

export type SavedSetting = (typeof SAVED_SETTINGS)[number];

/** The `UiState` fields a project does not keep, and why. */
export const NOT_SAVED = {
  status: 'the status line',
  statusWarnText: 'the status line',
  building: 'whether a build is running',
  hasParts: 'what the last build returned',
  loadedSampleId: 'which sample tile is marked; the picture itself is saved as `image`',
  palette: 'saved beside `settings` as `palette`, each colour\'s filament',
  artFitMm: 'reported by the last build',
  drawnShapeId: 'an id for this session; the drawn points are saved as `drawnShapeRings`',
  builtBodyMm: 'reported by the last build',
  switchBox: 'reported by the last build',
  holeNoRoom: 'reported by the last build',
  fitTestActive: 'the fit test is a view, not the design',
  fitTestStepMm: 'the fit test is a view, not the design',
  activeSwitchIndex: 'which switch the sliders move',
  view: 'the viewport',
  designView: 'the viewport',
  designSide: 'the viewport',
  showSwitch: 'the viewport',
  sectionOn: 'the viewport',
  sectionAxis: 'the viewport',
  sectionPos: 'the viewport',
  modelInfo: 'what the import made of the model; the model is saved as `model`',
  modelMeta: 'reported by the last build',
  textSizeMul: 'worked out from the text and its spacing',
  extrudeHeight: 'shown only while a height is dragged',
  selectedParts: 'the selection',
  canUndo: 'the undo history',
  canRedo: 'the undo history',
  canRefresh: 'the undo history',
} as const satisfies Partial<Record<keyof UiState, string>>;

/* A `UiState` field in neither list, or in both, names itself in the error. */
type MustBeNever<T extends never> = T;
export type UnplacedUiFields = MustBeNever<Exclude<keyof UiState, SavedSetting | keyof typeof NOT_SAVED>>;
export type DoublyPlacedUiFields = MustBeNever<Extract<keyof typeof NOT_SAVED, SavedSetting>>;

/** The range of every number a control offers, `[min, max]`, in the setting's own unit. The
 *  controls read their bounds from here, and a loaded file is held to the same. Most are named
 *  after their setting; the three inside an object say so (`fixedSizeMm`, `keychain*`). */
export const SETTING_LIMITS = {
  colorCount: [1, 12],
  capWidthMm: [20, 70],
  topThickness: [1, 4],
  imageDepth: [0.2, 3],
  /** Rim height is shown as `6.4 - capProud`, 0.4 to 6 mm, which is this range turned round. */
  capProud: [0.4, 6],
  designScale: [DESIGN_SCALE_MIN, DESIGN_SCALE_MAX],
  tolerance: [0.1, 1],
  stemFitMm: [STEM_FIT_MIN_MM, STEM_FIT_MAX_MM],
  stemOuterMm: [STEM_OUTER_MIN_MM, STEM_OUTER_MAX_MM],
  socketFitPct: [-5, 5],
  smoothing: [0, 1],
  extrudeChamferMm: [0, 1.2],
  lineSpacing: [0.5, 1.8],
  letterSpacing: [-0.08, 0.4],
  textBold: [-0.3, 0.8],
  textScale: [TEXT_SCALE_MIN, 2],
  keychainSlideMm: [-40, 40],
  /** Each side of a locked base size, mm. */
  fixedSizeMm: [24, 120],
  /** The keyring's fine offset along the edge, mm. */
  keychainOffsetMm: [-15, 15],
  /** The keyring's hole, mm: the widest the loop takes. A hole's tunnel is narrower, and the
   *  build says so when it makes one smaller. A loaded Hole keeps a size up to the loop's, as
   *  switching Loop to Hole does, so switching back gives the loop its size again. */
  keychainHoleMm: [3, 8],
} as const satisfies Record<string, readonly [number, number]>;

/** A held picture's size, mm, at most: no plate takes more, so a broken number cannot ask the
 *  build for a giant. */
export const ART_MM_MAX = 300;

/** The settings held whole (a count, not a measure). */
const WHOLE = new Set<string>(['colorCount']);
/** The limits that are a setting's own name, rather than a field inside an object. */
const FLAT_LIMITS = Object.entries(SETTING_LIMITS).filter(
  ([k]) => (SAVED_SETTINGS as readonly string[]).includes(k),
) as [SavedSetting, readonly [number, number]][];

const IMPORT_MODES: readonly UiState['importMode'][] = ['image', 'svg', 'icon', 'text', 'blocks', 'model'];
const COLOR_MODES: readonly UiState['colorMode'][] = ['normal', 'limited', 'mapped'];
const KEYCHAIN_SIDES: readonly KeychainSide[] = ['left', 'right', 'top', 'bottom'];
const BOOLEANS = ['hollowBase', 'removeBg', 'separateLetters', 'blank'] as const;
const STRINGS = ['baseShape', 'currentText', 'currentFontId', 'currentSvgText', 'currentSvgName', 'currentIconText', 'currentIconName', 'currentImageName'] as const;
/** At most this many switches on one clicker. */
const MAX_SWITCHES = 3;

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.max(lo, Math.min(hi, v));
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isRgb = (v: unknown): v is RGB => Array.isArray(v) && v.length === 3 && v.every((c) => isNum(c) && c >= 0 && c <= 255);

/** The keyring of a clicker that has none, as every project from before it opens. */
export const DEFAULT_KEYCHAIN: KeychainParams = { enabled: false, style: 'loop', angleDeg: 90, holeDiameterMm: 5.2, offsetMm: 0 };

/**
 * A loaded file's `settings`, each present key held to its type and range: numbers clamped,
 * a value of the wrong type dropped (so its default applies), the switches and the locked size
 * cleaned. Absent keys stay absent; keys this list does not know pass through untouched (an old
 * file's `stemFitPct` is read by `applyProject`). Never throws.
 */
export function coerceSettings(raw: unknown): Record<string, any> {
  if (!isObj(raw)) return {};
  const out: Record<string, any> = { ...raw };
  const drop = (k: string) => delete out[k];
  for (const [k, range] of FLAT_LIMITS) {
    if (!(k in out)) continue;
    const v = out[k];
    if (isNum(v)) out[k] = clamp(WHOLE.has(k) ? Math.round(v) : v, range);
    else drop(k);
  }
  if ('artMm' in out && out.artMm !== null) {
    if (isNum(out.artMm) && out.artMm > 0) out.artMm = Math.min(ART_MM_MAX, out.artMm);
    else drop('artMm');
  }
  if ('importMode' in out && !IMPORT_MODES.includes(out.importMode)) drop('importMode');
  if ('colorMode' in out && !COLOR_MODES.includes(out.colorMode)) drop('colorMode');
  if ('keychainEnd' in out && !KEYCHAIN_SIDES.includes(out.keychainEnd)) drop('keychainEnd');
  for (const k of BOOLEANS) if (k in out && typeof out[k] !== 'boolean') drop(k);
  for (const k of STRINGS) if (k in out && typeof out[k] !== 'string') drop(k);
  if ('packShapeToken' in out && out.packShapeToken !== null && typeof out.packShapeToken !== 'string') drop('packShapeToken');
  if ('fixedSize' in out && out.fixedSize !== null) {
    const f = out.fixedSize;
    if (isObj(f) && isNum(f.w) && isNum(f.h)) out.fixedSize = { w: clamp(f.w, SETTING_LIMITS.fixedSizeMm), h: clamp(f.h, SETTING_LIMITS.fixedSizeMm) };
    else drop('fixedSize');
  }
  if ('imageOffset' in out) {
    const o = out.imageOffset;
    if (isObj(o) && isNum(o.x) && isNum(o.y)) out.imageOffset = { x: o.x, y: o.y };
    else drop('imageOffset');
  }
  if ('switches' in out) {
    const list = Array.isArray(out.switches)
      ? out.switches.filter((w): w is Record<string, unknown> => isObj(w) && isNum(w.x) && isNum(w.y))
        .slice(0, MAX_SWITCHES)
        .map((w) => ({ x: w.x as number, y: w.y as number, rotation: isNum(w.rotation) ? w.rotation : 0 }))
      : [];
    if (list.length) out.switches = list;
    else drop('switches');
  }
  if ('bodyColorRgb' in out && !isRgb(out.bodyColorRgb)) drop('bodyColorRgb');
  if ('baseColorOverride' in out && out.baseColorOverride !== null && !isRgb(out.baseColorOverride)) drop('baseColorOverride');
  for (const k of ['limitedColors', 'paletteOverrides', 'customColors'] as const) {
    if (k in out) out[k] = Array.isArray(out[k]) ? out[k].filter(isRgb) : [];
  }
  return out;
}

/** A saved keyring. A project from before the keyring was an object saved `true` or nothing. A
 *  style other than a hole is the loop it always was. */
export function coerceKeychain(raw: unknown): KeychainParams {
  if (!isObj(raw)) return { ...DEFAULT_KEYCHAIN, enabled: raw === true };
  return {
    enabled: raw.enabled === true,
    style: raw.style === 'hole' ? 'hole' : 'loop',
    angleDeg: isNum(raw.angleDeg) ? ((raw.angleDeg % 360) + 360) % 360 : DEFAULT_KEYCHAIN.angleDeg,
    holeDiameterMm: isNum(raw.holeDiameterMm) ? clamp(raw.holeDiameterMm, SETTING_LIMITS.keychainHoleMm) : DEFAULT_KEYCHAIN.holeDiameterMm,
    offsetMm: isNum(raw.offsetMm) ? clamp(raw.offsetMm, SETTING_LIMITS.keychainOffsetMm) : DEFAULT_KEYCHAIN.offsetMm,
    // Absent stays absent, which is a cut hole: a hole saved before holes were placed first was cut.
    ...(typeof raw.holeCut === 'boolean' ? { holeCut: raw.holeCut } : {}),
  };
}

/** A saved Model-mode cut, over the defaults one object at a time, so a file that saved only
 *  part of one (`{ sizeMm: 50 }`, or a `button` without its size) keeps the rest. The buttons
 *  are held to what a model can have. */
export function coerceModelCut(raw: unknown): ModelCutParams {
  const r = isObj(raw) ? raw : {};
  const D = DEFAULT_MODEL_CUT;
  const part = <K extends 'slice' | 'stand' | 'button' | 'switchNudge' | 'colors'>(k: K): ModelCutParams[K] =>
    ({ ...D[k], ...(isObj(r[k]) ? r[k] : {}) }) as ModelCutParams[K];
  const numOrNull = (v: unknown) => (isNum(v) ? v : null);
  const more: ExtraButton[] = Array.isArray(r.more)
    ? r.more.filter(isObj).slice(0, MAX_BUTTONS - 1).map((b) => ({
      x: numOrNull(b.x),
      y: numOrNull(b.y),
      nudgeX: isNum(b.nudgeX) ? b.nudgeX : 0,
      nudgeY: isNum(b.nudgeY) ? b.nudgeY : 0,
      rotation: isNum(b.rotation) ? b.rotation : 0,
    }))
    : [];
  const rotation = Array.isArray(r.rotation) && r.rotation.length === 3 && r.rotation.every(isNum)
    ? (r.rotation as [number, number, number])
    : D.rotation;
  return {
    ...D,
    ...r,
    rotation,
    slice: part('slice'),
    stand: part('stand'),
    button: part('button'),
    switchNudge: part('switchNudge'),
    colors: part('colors'),
    buttons: buttonCount({ buttons: isNum(r.buttons) ? r.buttons : 1 }),
    more,
  } as ModelCutParams;
}

const CROP_RATIOS: readonly PreprocessParams['cropRatio'][] = ['free', '1:1', '4:3', '3:2', '16:9'];

/** The picture window's saved sliders, over its defaults field by field; null when there are
 *  none (the window then opens on its defaults). */
export function coercePreprocess(raw: unknown): PreprocessParams | null {
  if (!isObj(raw)) return null;
  const out: PreprocessParams = { ...DEFAULT_PREPROCESS };
  for (const k of Object.keys(DEFAULT_PREPROCESS) as (keyof PreprocessParams)[]) {
    const v = raw[k];
    if (k === 'cropRatio') {
      if (CROP_RATIOS.includes(v as PreprocessParams['cropRatio'])) out.cropRatio = v as PreprocessParams['cropRatio'];
    } else if (k === 'keepBackground') {
      if (typeof v === 'boolean') out.keepBackground = v;
    } else if (isNum(v)) {
      out[k] = v;
    }
  }
  return out;
}

/** What the picture window last ran on and with, as a project keeps it (top-level `picture`):
 *  its sliders, and the picture before they changed it, only when that differs from `image`. */
export interface SavedPicture {
  preprocess: PreprocessParams;
  source: string | null;
}

/** A saved `picture`, or null when it is not one. */
export function coercePicture(raw: unknown): { preprocess: PreprocessParams | null; source: string | null } | null {
  if (!isObj(raw)) return null;
  return {
    preprocess: coercePreprocess(raw.preprocess),
    source: typeof raw.source === 'string' && raw.source.startsWith('data:image/') ? raw.source : null,
  };
}
