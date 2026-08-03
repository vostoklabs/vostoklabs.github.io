import '@vostok/ui-kit/styles.css';
import './style.css';

import {
  appShell,
  topbarLinks,
  generatorHeader,
  qualityCallout,
  sidebarFooter,
  openLicenseModal,
  licenseReminderToast,
  sliderRow,
  segmentedControl,
  toggleSwitch,
  toast,
  dialog,
  el,
  selectField,
  svgEl,
  helpTip,
  dpad,
  ICONS,
} from '@vostok/ui-kit';
import { BRAND } from '@vostok/brand';
import type { RegionSet } from './types';
import { createStore } from './store/store';
import { loadFileToImage, loadUrlToImage, type RgbaImage } from './image/decode';
import { processImage } from './image/pipeline';
import { parseSvg } from './image/logo';
import { SAMPLES } from './image/sample';
import { createViewer, type Viewer, type ViewPreset } from './viewer/viewer';
import { downloadThreeMF } from './export/threemfExport';
import { openMagnetWizard } from './ui/wizard';
import { runImportWizard } from './ui/import-wizard';
import { DEFAULT_PREPROCESS, type PreprocessParams } from './types';
import type {
  BuildRegion,
  GeometryRequest,
  GeometryResponse,
  MagnetBuildParams,
  MagnetPart,
  MagnetPlacement,
  MagnetPlacementEntry,
  MagnetReport,
  MagnetShapeKind,
  PocketProfile,
  ProductType,
  RGB,
  SliderLayout,
  BaseShapeKind,
  MagnetMode,
} from './types';

/** What clicking on the model does. */
type EditMode = 'color' | 'extrude' | 'magnet';
import { FILAMENTS, MAGNET_PRESETS, sliderGridSpec, sliderMinBodySizeFor } from './types';

const IMG_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
const SVG_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>';
const UPLOAD_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>';

// ---------------------------------------------------------------------------
// Print rules. These are the invariants the UI protects the user from breaking —
// the geometry clamps to them too, but silently producing a magnet that doesn't
// fit its own pocket is not an acceptable outcome, so we enforce them up front.
// ---------------------------------------------------------------------------
/** Solid body always kept above the magnet (toward the image face). */
const COVER_MIN = 0.8;
/** Wall left between the magnet and the fridge in embedded mode. */
const BACK_WALL_MIN = 0.5;
const BACK_WALL_MAX = 1.5;
const MAX_LEVEL = 3; // per-region raise levels (× stepHeight)
const WIZARD_KEY = 'magnet-generator-wizard-seen';

// ---------------------------------------------------------------------------
// State (serializable). Runtime data (image bitmap, traced regions, mesh) stays
// outside so Save/Load round-trips cleanly.
// ---------------------------------------------------------------------------
interface Settings {
  sourceName: string;
  colorCount: number;
  smoothing: number;
  removeBg: boolean;
  /** `userSet` marks a colour the user deliberately chose, so it survives a
   *  re-trace while an auto-detected one is refreshed from the new image. */
  palette: { quantRgb: RGB; filamentRgb: RGB; level: number; userSet?: boolean }[];
  /** Per-shape colour overrides, keyed by part name (`inlay-<region>-<part>`).
   *
   *  A palette row is one *quantised colour*, and one quantised colour is
   *  usually several disconnected shapes — the dog's face and its ear shadows
   *  land in the same bucket. Recolouring from the sidebar should still move all
   *  of them, but clicking one shape on the model should move only that shape,
   *  so a click writes an override here instead of into the palette. */
  componentColors: Record<string, RGB>;
  baseShape: BaseShapeKind;
  fitSizeMm: number;
  thickness: number;
  imageMargin: number;
  cornerRadius: number;
  bevelEdge: boolean;
  bevelSize: number;
  bodyRgb: RGB;
  colorBleed: number;
  stepHeight: number;
  extrudeChamfer: boolean;
  magnetMode: MagnetMode;
  magnetShape: MagnetShapeKind;
  magnetDiameter: number;
  magnetX: number;
  magnetY: number;
  magnetDepth: number;
  backWall: number;
  magnetCount: number;
  pocketFit: number;
  pocketProfile: PocketProfile;

  magnetPlacement: MagnetPlacement;
  /** Absolute pocket centres (mm from the body centre) once placement is manual. */
  magnets: MagnetPlacementEntry[];
  /** Whether to show a visual helper in 'none' mode (magnetic sheet). */
  sheetHelperEnabled: boolean;

  // ---- Slider fields ----
  productType: ProductType;
  sliderLayout: SliderLayout;
  sliderMirrorBlank: boolean;
  /** Extra plastic between slider pockets, on top of the 2 mm minimum, mm. */
  sliderGap: number;
}

/** A fidget slider is a pocket toy, not a fridge magnet — 70 mm is a coaster.
 *  55 mm holds 8 ⌀6×3 magnets per half with the default spacing. */
const SLIDER_DEFAULT_SIZE = 55;

const DEFAULT_SETTINGS: Settings = {
  sourceName: '',
  colorCount: 4,
  smoothing: 0.5,
  removeBg: true,
  palette: [],
  componentColors: {},
  baseShape: 'outline',
  fitSizeMm: 70,
  thickness: 3,
  imageMargin: 1.5,
  cornerRadius: 6,
  bevelEdge: true,
  bevelSize: 0.6,
  bodyRgb: [232, 232, 236],
  colorBleed: 0.12,
  stepHeight: 0.6,
  extrudeChamfer: false,
  // A magnet generator opens with a magnet. ⌀10×2 discs are the commonest
  // fridge-magnet stock and fit the default 3 mm body with room to spare.
  magnetMode: 'glue-on',
  magnetShape: 'disc',
  magnetDiameter: 10,
  magnetX: 20,
  magnetY: 10,
  magnetDepth: 2,
  backWall: 0.8,
  sheetHelperEnabled: false,
  magnetCount: 1,
  // Added to the magnet's DIAMETER, not its radius: a ⌀6 magnet gets a ⌀6.2
  // socket. 0.2 mm is a press fit on a well-tuned printer.
  pocketFit: 0.2,
  pocketProfile: 'round',
  magnetPlacement: 'auto',
  magnets: [],
  productType: 'magnet',
  sliderLayout: 6,
  sliderMirrorBlank: false,
  // Packed at the 2 mm printable minimum the pockets read as one solid block.
  // 3 mm of plastic between them is what makes the array look deliberate.
  sliderGap: 3,
};

const store = createStore<{
  settings: Settings;
  building: boolean;
  status: string;
  warnings: string[];
  report: MagnetReport | null;
  hasParts: boolean;
  editMode: EditMode;
  selectedRegions: number[];
}>({
  settings: { ...DEFAULT_SETTINGS, palette: [] },
  building: false,
  status: '',
  warnings: [],
  report: null,
  hasParts: false,
  editMode: 'color',
  selectedRegions: [],
});

const s = () => store.get().settings;
/** Patch settings and queue a geometry rebuild. */
const patch = (p: Partial<Settings>) => {
  store.set({ settings: enforceFit({ ...s(), ...p }) });
  scheduleRebuild();
};
/** Patch settings without touching the geometry (image-pipeline params). */
const patchImage = (p: Partial<Settings>) => {
  store.set({ settings: { ...s(), ...p } });
};

/** Store subscriptions owned by the rebuildable settings sections, dropped
 *  whenever those sections are torn down (Undo, project load, wizard). */
const sectionSubs: (() => void)[] = [];
const ownSub = (fn: () => void) => sectionSubs.push(store.subscribe(fn));

// ---- Runtime (non-serialized) ----
/** The image the pipeline traces — already cropped + tone-adjusted by the import
 *  wizard. processImage() MUST clone this: it mutates its input (matte + quantize),
 *  so tracing the live copy repeatedly bleeds every re-trace toward black. */
let originalImage: RgbaImage | null = null;
/** The untouched decode, kept so re-opening the wizard starts from the original. */
let baseImage: RgbaImage | null = null;
/** The last wizard settings, so re-opening keeps the user's tuning. */
let preprocess: PreprocessParams = { ...DEFAULT_PREPROCESS };
let svgText: string | null = null;
let regionSet: RegionSet | null = null;
let latestParts: MagnetPart[] = [];
let downloads = 0;
let refitNext = true;
let firstBuildDone = false;
/** Which magnet the pad and the stage drag act on. */
let activeMagnet = 0;
/** Assigned by magnetSection(); lets the stage panel refresh the sidebar form. */
let redrawMagnetSection: () => void = () => {};

// ---------------------------------------------------------------------------
// Fit rules
// ---------------------------------------------------------------------------
/** Thinnest body that can hold the configured magnet. */
function minThickness(v: Settings): number {
  if (v.magnetMode === 'none') return 1.5;
  const back = v.magnetMode === 'embedded' ? clamp(v.backWall, BACK_WALL_MIN, BACK_WALL_MAX) : 0;
  return round1(v.magnetDepth + back + COVER_MIN);
}

/** The body never ends up thinner than the magnet needs — raising the magnet
 *  height raises the body with it rather than cutting a pocket that can't hold it. */
function enforceFit(v: Settings): Settings {
  let out = v;
  // A slider is two magnet arrays facing each other — "magnetic sheet" has no
  // meaning here, so a slider always carries real pockets.
  if (out.productType === 'slider' && out.magnetMode === 'none') {
    out = { ...out, magnetMode: 'glue-on' };
  }
  const min = minThickness(out);
  if (out.thickness < min) out = { ...out, thickness: min };
  // Slider mode: the body must be long enough to hold the whole magnet array.
  if (out.productType === 'slider') {
    const minSize = sliderMinBodySize(out);
    if (out.fitSizeMm < minSize) out = { ...out, fitSizeMm: Math.ceil(minSize) };
  }
  return out;
}

/** The slider's magnet array for the current settings. Same function the
 *  geometry uses, so the size floor the UI enforces is exactly the size the
 *  builder needs — they used to compute it two different ways, and the UI's
 *  answer was 0.4 mm short of the builder's, so no pocket was ever cut. */
function sliderGrid(v: Settings) {
  return sliderGridSpec({
    layout: v.sliderLayout,
    magnetShape: v.magnetShape,
    magnetDiameter: v.magnetDiameter,
    magnetX: v.magnetX,
    magnetY: v.magnetY,
    pocketFit: v.pocketFit,
    gap: v.sliderGap,
  });
}

/** Minimum body longest-side to fit a slider's magnet array in the chosen shape. */
function sliderMinBodySize(v: Settings): number {
  return sliderMinBodySizeFor(v.baseShape, v.cornerRadius, sliderGrid(v));
}

/** The settings a slider needs regardless of how you got here. */
function sliderDefaults(v: Settings): Settings {
  return {
    ...v,
    productType: 'slider',
    // Magnetic sheet has no meaning for a slider — it needs real pockets.
    magnetMode: v.magnetMode === 'none' ? 'glue-on' : v.magnetMode,
    magnetCount: v.sliderLayout,
    magnetPlacement: 'auto',
  };
}

/** Switching to a slider is the one moment the app already knows the design
 *  probably can't hold a magnet array — an image outline is rarely a rectangle,
 *  and a fridge magnet's size is set for a fridge. Rather than flip the product
 *  and immediately throw a warning, offer the two fixes and let the user pick. */
function switchToSlider() {
  const base = sliderDefaults(s());
  const minSize = sliderMinBodySize(base);
  const target = Math.max(SLIDER_DEFAULT_SIZE, Math.ceil(minSize));
  const isOutline = base.baseShape === 'outline';
  const tooSmall = base.fitSizeMm < minSize;

  // Picking an action closes the dialog, which fires onClose — so onClose must
  // only supply the "changed nothing" default when no action ran. Same latch
  // shape the wizard uses for its escape hatch.
  let chosen = false;
  const apply = (extra: Partial<Settings>) => {
    patch({ ...base, ...extra });
    rebuildSections();
  };

  if (!isOutline && !tooSmall) {
    apply({});
    return;
  }

  const reason = isOutline
    ? `A slider's magnets sit in a rectangular grid, and your body is following the image outline. ` +
      `That shape usually has nowhere to put ${base.sliderLayout} magnets with a 2 mm wall around each.`
    : `A slider needs at least ${minSize.toFixed(0)} mm along the slide axis to fit ` +
      `${base.sliderLayout} magnets per half. Yours is ${base.fitSizeMm} mm.`;

  const d = dialog({
    title: 'This design is too small for a slider',
    content: el('div', { className: 'mg-wizard' }, [
      el('p', { className: 'vl-hint', text: reason }),
      el('p', { className: 'vl-hint', text: 'How do you want to fix it?' }),
    ]),
    onClose: () => {
      if (!chosen) apply({});
    },
    actions: [
      {
        label: `Use a rounded rectangle at ${target} mm`,
        primary: true,
        onClick: () => {
          chosen = true;
          d.close();
          apply({ baseShape: 'roundedRect', fitSizeMm: target });
        },
      },
      {
        label: `Keep this shape, resize to ${target} mm`,
        onClick: () => {
          chosen = true;
          d.close();
          apply({ fitSizeMm: target });
        },
      },
    ],
  });
}

/** Drop every per-shape override belonging to one palette row. */
function dropOverridesForRegion(overrides: Record<string, RGB>, region: number): Record<string, RGB> {
  const prefix = `inlay-${region}-`;
  const out: Record<string, RGB> = {};
  for (const [k, v] of Object.entries(overrides)) if (!k.startsWith(prefix)) out[k] = v;
  return out;
}

/** Distinct colours the model asks for — one filament slot each, the same way
 *  the 3MF exporter assigns them. Per-shape overrides can push this past the
 *  palette count, and a 4-slot AMS is what most people are working with, so the
 *  UI has to say when it's been passed rather than let the slicer be the one to
 *  tell. Read from the settings the next build will use, not from the last mesh,
 *  so it updates on the click rather than a build later. (A shape clipped away
 *  entirely still counts here — it errs high, which is the safe direction.) */
function filamentSlotCount(): number {
  const v = s();
  const seen = new Set<string>([v.bodyRgb.join(',')]);
  regionSet?.regions.forEach((r, i) => {
    const base = v.palette[i]?.filamentRgb ?? r.quantRgb;
    r.components.forEach((_, j) => {
      seen.add((v.componentColors[`inlay-${i}-${j}`] ?? base).join(','));
    });
  });
  return seen.size;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------------------
// History (Undo / Redo)
// ---------------------------------------------------------------------------
const undoStack: Settings[] = [];
const redoStack: Settings[] = [];
let isUndoRedo = false;
const undoBtn = iconButton(ICONS.undo ?? '', 'Undo', 'Undo (Ctrl+Z)', () => undo());
const redoBtn = iconButton(ICONS.redo ?? '', 'Redo', 'Redo (Ctrl+Shift+Z)', () => redo());

function iconButton(icon: string, label: string, title: string, onClick: () => void) {
  const btn = el('button', {
    className: 'vl-btn',
    attrs: { type: 'button', title, 'aria-label': label },
    on: { click: onClick },
  }) as HTMLButtonElement;
  if (icon) btn.append(svgEl(icon));
  else btn.textContent = label;
  return btn;
}

function syncHistoryButtons() {
  undoBtn.disabled = undoStack.length === 0;
  redoBtn.disabled = redoStack.length === 0;
}
syncHistoryButtons();

/** Make the current settings the floor of the history. Called once the first
 *  model is on screen and whenever a new source is imported — otherwise the
 *  palette the tracer just wrote counts as an edit, and Ctrl+Z on a fresh load
 *  would strip the colors off. */
function resetHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
  baseline = clone(s());
  syncHistoryButtons();
}

const clone = (v: Settings): Settings => JSON.parse(JSON.stringify(v));

/** The last state committed to history. Edits push THIS onto the undo stack and
 *  then become the new baseline — pushing the current state instead would make
 *  the first Ctrl+Z a no-op. */
let baseline: Settings = clone(store.get().settings);

function applyHistory(next: Settings) {
  isUndoRedo = true;
  store.set({ settings: next });
  isUndoRedo = false;
  baseline = clone(next);
  rebuildSections();
  scheduleRebuild();
  syncHistoryButtons();
}

function undo() {
  if (undoStack.length === 0) return;
  redoStack.push(clone(s()));
  applyHistory(undoStack.pop()!);
}

function redo() {
  if (redoStack.length === 0) return;
  undoStack.push(clone(s()));
  applyHistory(redoStack.pop()!);
}

let historyDebounce: ReturnType<typeof setTimeout> | null = null;
store.subscribe((state) => {
  if (isUndoRedo) return;
  if (historyDebounce) clearTimeout(historyDebounce);
  historyDebounce = setTimeout(() => {
    if (JSON.stringify(state.settings) === JSON.stringify(baseline)) return;
    undoStack.push(baseline);
    baseline = clone(state.settings);
    if (undoStack.length > 50) undoStack.shift();
    redoStack.length = 0;
    syncHistoryButtons();
  }, 800);
});

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (!(e.ctrlKey || e.metaKey)) return;
  const key = e.key.toLowerCase();
  if (key === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
  } else if (key === 'y') {
    e.preventDefault();
    redo();
  }
});

// ---------------------------------------------------------------------------
// Local controls
// ---------------------------------------------------------------------------
/** A compact labelled number field — for the dimensions the user reads off a
 *  magnet's packaging, where a slider would be the wrong instrument. */
function numberField(opts: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  help?: string;
  onChange: (v: number) => void;
}): HTMLElement {
  const input = el('input', {
    attrs: {
      type: 'number',
      min: String(opts.min),
      max: String(opts.max),
      step: String(opts.step ?? 1),
      inputmode: 'decimal',
    },
  }) as HTMLInputElement;
  let current = opts.value;
  input.value = String(current);
  const commit = () => {
    const parsed = parseFloat(input.value);
    const v = Number.isFinite(parsed) ? clamp(parsed, opts.min, opts.max) : current;
    input.value = String(v);
    if (v === current) return;
    current = v;
    opts.onChange(v);
  };
  input.addEventListener('change', commit);
  input.addEventListener('blur', commit);

  const label = el('label', { text: opts.label });
  if (opts.help) label.append(helpTip(opts.help));
  const box = el('div', { className: 'mg-num__input' }, [input]);
  if (opts.unit) box.append(el('span', { className: 'mg-num__unit', text: opts.unit }));
  return el('div', { className: 'vl-field mg-num' }, [label, box]);
}

/** A collapsible numbered step, matching the clicker's sidebar sections. */
function step(n: number, title: string, body: (HTMLElement | Node)[], open = false): HTMLElement {
  const details = el('details', { className: 'vl-section section-collapsible' }, [
    el('summary', { className: 'vl-label collapsible-head', text: `${n} · ${title}` }),
    el('div', { className: 'collapsible-body' }, body),
  ]) as HTMLDetailsElement;
  details.open = open;
  return details;
}

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------
const quality = qualityCallout({
  html: `Print flat on the back face with the image up — no supports needed. Profiles and print notes are on <a href="${BRAND.urls.makerworld}" target="_blank" rel="noopener">MakerWorld</a>.`,
  storageKey: 'magnet-generator-quality-callout',
});

// Same shape as the clicker's footer: one export button, then Save / Load /
// Help / theme. The licence nudge lives on the export path (modal on the first
// download, toast after) exactly as the clicker does it — not as a sidebar line.
const footer = sidebarFooter({
  formats: [{ id: '3mf', label: '3MF' }],
  onExport: (format) => exportModel(format),
  onSave: saveProject,
  onLoad: loadProject,
  onHelp: showHelp,
  themeStorageKey: 'magnet-generator-theme',
});

const shell = appShell({
  topbar: topbarLinks({ githubUrl: BRAND.urls.github }),
  left: {
    scroll: [
      generatorHeader({
        title: 'Image to Fridge Magnet',
        description: 'Turn any image into a fridge magnet — flat back, glue-on or embedded magnet.',
      }),
      ...(quality ? [quality] : []),
      // Magnet first and open: it's the whole point of this generator.
      magnetSection(),
      shapeSection(),
      colorsSection(),
    ],
    footer: [el('div', { className: 'vl-btn-row' }, [undoBtn, redoBtn])],
  },
  stage: [
    el('p', { className: 'vl-stage__label', text: 'Live 3D Preview' }),
    el('p', { className: 'vl-stage__hint', text: 'Hold left click to rotate, right click to pan, scroll to zoom.' }),
  ],
  right: {
    scroll: [importSourceSection()],
    footer: [footer],
  },
});

document.getElementById('app')!.append(shell.root);

// ---------------------------------------------------------------------------
// Stage: viewer, view bar, edit-mode bar, extrude panel, status
// ---------------------------------------------------------------------------
const stageContainer = el('div', { className: 'mg-stage-canvas' });
shell.stage.prepend(stageContainer);
const viewer: Viewer = createViewer(stageContainer);

const statusEl = el('p', { className: 'mg-status', text: 'Loading…' });
shell.stage.append(statusEl);

// --- View switching (programmatic only — the visible bar is removed). ---
const viewButtons = new Map<ViewPreset | 'fit', HTMLButtonElement>();
const setView = (preset: ViewPreset) => {
  viewer.setView(preset);
};

// --- Edit mode bar (Color / Extrude / Magnet), ported from the clicker ---
const editModeBar = el('div', { className: 'edit-mode-bar', attrs: { role: 'group' } });
const modeBtn = (mode: EditMode, label: string, icon: string) => {
  const b = el('button', {
    className: 'edit-mode-btn' + (store.get().editMode === mode ? ' active' : ''),
    attrs: { type: 'button', 'data-editmode': mode },
  });
  b.append(svgEl(icon), el('span', { text: label }));
  return b;
};
editModeBar.append(
  modeBtn('color', 'Color', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>'),
  modeBtn('extrude', 'Extrude', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>'),
  modeBtn('magnet', 'Magnet', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v9a6 6 0 0 0 12 0V3"/><path d="M6 8h4"/><path d="M14 8h4"/></svg>'),
);
shell.stage.append(editModeBar);

// --- Magnet mode: a slim hint pinned at the top of the stage (no center panel
//     obstructing the model — count & reset live in the left sidebar). ---
const magnetHintText = el('span');
const magnetHintAdd = el('button', { className: 'mg-chip mg-chip--add', text: '+', attrs: { type: 'button', title: 'Add magnet' }, on: { click: addMagnet } });
const magnetHintRemove = el('button', { className: 'mg-chip mg-chip--add', text: '−', attrs: { type: 'button', title: 'Remove magnet' }, on: { click: () => removeMagnet(activeMagnet) } });
const magnetHint = el('div', { className: 'mg-magnet-hint', attrs: { hidden: '' } }, [
  magnetHintRemove,
  magnetHintText,
  magnetHintAdd,
]);
shell.stage.append(magnetHint);

// --- Extrude panel (floating, clicker-style) ---
const extrudeLevelLabel = el('div', { className: 'extrude-level-label', text: 'Select a part' });
const extrudeMinus = el('button', { className: 'vl-btn vl-btn--icon', attrs: { type: 'button', 'aria-label': 'Lower' }, text: '−' }) as HTMLButtonElement;
const extrudePlus = el('button', { className: 'vl-btn vl-btn--icon', attrs: { type: 'button', 'aria-label': 'Raise' }, text: '+' }) as HTMLButtonElement;
const extrudeChamferEl = el('input', { attrs: { type: 'checkbox', id: 'mgExtrudeChamfer' } }) as HTMLInputElement;
extrudeChamferEl.checked = s().extrudeChamfer;
const extrudePanel = el('div', { className: 'edges-panel', attrs: { hidden: '' } }, [
  el('div', { className: 'edges-title', text: 'Extrude Part' }),
  extrudeLevelLabel,
  el('div', { className: 'tol-stepper' }, [extrudeMinus, extrudePlus]),
  el('div', { className: 'extrude-chamfer-row' }, [
    el('span', { text: 'Chamfer raised edges' }),
    el('label', { className: 'toggle' }, [extrudeChamferEl, el('span', { className: 'slider' })]),
  ]),
  el('div', { className: 'panel-hint', text: 'Click a color on the model to select it, then raise or lower it. Click another to add it to the selection.' }),
]);
shell.stage.append(extrudePanel);

const syncEditMode = () => {
  const m = store.get().editMode;
  editModeBar.querySelectorAll('.edit-mode-btn').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-editmode') === m);
  });
  extrudePanel.toggleAttribute('hidden', m !== 'extrude');
  magnetHint.toggleAttribute('hidden', m !== 'magnet');
  // The magnet hint and the interaction hint share the bottom-center slot.
  shell.stage.querySelector('.vl-stage__hint')?.classList.toggle('hidden', m === 'magnet');
  viewer.setOrbitEnabled(m !== 'magnet');
  viewer.setPlacementMode(m === 'magnet');
  syncMagnetHandles();
};

/** Magnet markers. Drawn whenever pockets exist — an embedded pocket is buried in
 *  the solid, so without these you can't see where your magnets are. In Magnet
 *  mode they brighten and become draggable. */
function syncMagnetHandles() {
  const state = store.get();
  const report = state.report;
  const v = state.settings;
  const interactive = state.editMode === 'magnet';
  const clear = () =>
    viewer.setMagnetHandles({ positions: [], magnetRadius: 0, outline: 'circle', active: -1, interactive: false });

  if (!report || report.positions.length === 0) {
    if (v.magnetMode === 'none' && v.sheetHelperEnabled) {
      activeMagnet = clamp(activeMagnet, 0, 0);
      const m = v.magnets[0] ?? { x: 0, y: 0, rotation: 0 };
      viewer.setMagnetHandles({
        positions: [[m.x, m.y]],
        magnetRadius: Math.hypot(v.magnetX, v.magnetY) / 2,
        outline: 'rect',
        size: [v.magnetX, v.magnetY],
        rotations: [m.rotation],
        active: activeMagnet,
        interactive,
      });
      if (interactive) {
        magnetHintText.textContent = 'Drag the visual helper to see if your sheet fits.';
      }
      return;
    }

    clear();
    if (interactive) {
      magnetHintText.textContent =
        v.magnetMode === 'none'
          ? 'This design uses magnetic sheet — there are no pockets to place.'
          : 'No magnet fits this design yet.';
    }
    return;
  }

  // Clamp against the requested count, not the last report — right after adding a
  // magnet the report is still the previous build and would steal the selection
  // back from the magnet the user just created.
  activeMagnet = clamp(activeMagnet, 0, Math.max(0, v.magnetCount - 1));

  let positions = [...report.positions];
  if (v.magnetPlacement === 'manual') {
    positions = positions.map((p, i) => {
      const m = v.magnets[i];
      return m ? [m.x, m.y] : p;
    });
  }
  let rotations = report.rotations;
  // A slider is two pieces on the plate, and the report only carries the first
  // one's centres — mark up the second half too, or half the model looks empty.
  if (v.productType === 'slider' && report.sliderOffsetX) {
    const dx = report.sliderOffsetX;
    positions = [...positions, ...positions.map((p) => [p[0] + dx, p[1]] as [number, number])];
    rotations = [...rotations, ...rotations];
  }

  viewer.setMagnetHandles({
    positions,
    magnetRadius: report.magnetRadius,
    outline: v.magnetShape === 'block' ? 'rect' : v.pocketProfile === 'hex' ? 'hex' : 'circle',
    size: [v.magnetX, v.magnetY],
    rotations,
    // Slider pockets come from the shared array, so there is nothing to drag.
    active: v.productType === 'slider' ? -1 : activeMagnet,
    interactive: interactive && v.productType !== 'slider',
  });

  if (interactive) {
    magnetHintText.textContent =
      v.productType === 'slider'
        ? 'Slider magnets sit on a fixed pitch — both halves have to match, so they can’t be moved individually.'
        : report.positions.length > 1
          ? `Drag a magnet to move it · #${activeMagnet + 1} of ${report.positions.length} selected`
          : 'Drag the magnet to move it, or click the shape to place it there';
  }
}
const syncExtrudePanel = () => {
  const sel = store.get().selectedRegions;
  if (sel.length === 0) {
    extrudeLevelLabel.textContent = 'Select a part';
    extrudeMinus.disabled = true;
    extrudePlus.disabled = true;
    return;
  }
  const level = s().palette[sel[0]]?.level ?? 0;
  const h = (level * s().stepHeight).toFixed(2);
  extrudeLevelLabel.textContent =
    sel.length > 1 ? `${sel.length} colors · Level: ${level} · ${h} mm` : `Level: ${level} · ${h} mm`;
  extrudeMinus.disabled = level <= 0;
  extrudePlus.disabled = level >= MAX_LEVEL;
};
extrudeChamferEl.addEventListener('change', () => patch({ extrudeChamfer: extrudeChamferEl.checked }));
extrudeMinus.addEventListener('click', () => extrudeStep(-1));
extrudePlus.addEventListener('click', () => extrudeStep(1));
editModeBar.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('[data-editmode]') as HTMLElement | null;
  if (!btn) return;
  const mode = (btn.getAttribute('data-editmode') ?? 'color') as EditMode;
  store.set({ editMode: mode, selectedRegions: [] });
  viewer.clearHighlight();
  syncEditMode();
  syncExtrudePanel();
  // The pockets are on the back — put the camera where the work is.
  if (mode === 'magnet' && s().magnetMode !== 'none') setView('back');
});

function extrudeStep(delta: number) {
  const sel = store.get().selectedRegions;
  if (sel.length === 0) return;
  patch({
    palette: s().palette.map((p, i) =>
      sel.includes(i) ? { ...p, level: clamp(p.level + delta, 0, MAX_LEVEL) } : p,
    ),
  });
}

// --- Part picking: Color mode recolors, Extrude mode selects regions ---
const flashRow = (palIndex: number) => {
  const row = document.querySelectorAll<HTMLElement>('.fil-row.region-row')[palIndex];
  if (!row) return;
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row.classList.add('mg-flash');
  setTimeout(() => row.classList.remove('mg-flash'), 1200);
};
const regionIndices = (regionIdx: number): number[] =>
  latestParts.map((p, i) => ({ p, i })).filter(({ p }) => p.name.startsWith(`inlay-${regionIdx}-`)).map(({ i }) => i);

viewer.onPartPick((index, clientX, clientY) => {
  const mode = store.get().editMode;
  if (index === null) {
    if (mode === 'extrude') {
      store.set({ selectedRegions: [] });
      syncExtrudePanel();
    }
    viewer.clearHighlight();
    return;
  }
  const part = latestParts[index];
  if (!part) return;
  const m = part.name.match(/^inlay-(\d+)/);
  const regionIdx = m ? Number(m[1]) : -1;

  if (mode === 'color') {
    viewer.highlightPart(index);
    if (regionIdx >= 0) {
      flashRow(regionIdx);
      // Clicking a shape recolours THAT shape. The palette row keeps recolouring
      // the whole bucket — that's what the sidebar swatch is for.
      const partName = part.name;
      const rgb = s().componentColors[partName] ?? s().palette[regionIdx]?.filamentRgb ?? part.colorRgb;
      showColorPopover(clientX, clientY, `#${rgbToHex(rgb)}`, (hex) => {
        patch({ componentColors: { ...s().componentColors, [partName]: hexToRgb(hex) } });
      });
    } else {
      showColorPopover(clientX, clientY, `#${rgbToHex(s().bodyRgb)}`, (hex) => patch({ bodyRgb: hexToRgb(hex) }));
    }
    return;
  }

  if (regionIdx >= 0) {
    const sel = store.get().selectedRegions;
    store.set({
      selectedRegions: sel.includes(regionIdx) ? sel.filter((r) => r !== regionIdx) : [...sel, regionIdx],
    });
    viewer.highlightPart(regionIndices(regionIdx)[0] ?? index);
    flashRow(regionIdx);
    syncExtrudePanel();
  }
});

// --- Magnet mode: drag the pockets around on the model itself ---
/** Snapshot the positions the builder produced so manual mode starts exactly
 *  where auto left off — no jump when you grab the first ring. */
function seedManualPositions(): MagnetPlacementEntry[] {
  const report = store.get().report;
  const cur = s().magnets;
  const from = report?.positions ?? [];
  return Array.from({ length: s().magnetCount }, (_, i) => ({
    x: from[i]?.[0] ?? cur[i]?.x ?? 0,
    y: from[i]?.[1] ?? cur[i]?.y ?? 0,
    rotation: cur[i]?.rotation ?? 0,
  }));
}

function moveMagnetTo(index: number, x: number, y: number) {
  const v = s();
  const list = v.magnetPlacement === 'manual' ? v.magnets.map((m) => ({ ...m })) : seedManualPositions();
  while (list.length <= index) list.push({ x: 0, y: 0, rotation: 0 });

  let dx = x;
  let dy = y;
  
  // Basic collision check to prevent magnets from completely overlapping during manual placement
  const circumR = v.magnetShape === 'disc' 
    ? v.magnetDiameter / 2 
    : Math.hypot(v.magnetX, v.magnetY) / 2;
  const minSpacing = circumR * 2 + 2;

  for (let i = 0; i < list.length; i++) {
    if (i === index) continue;
    const other = list[i];
    const dist = Math.hypot(dx - other.x, dy - other.y);
    if (dist < minSpacing) {
      if (dist < 0.001) {
        dx += minSpacing;
      } else {
        const push = minSpacing - dist;
        const angle = Math.atan2(dy - other.y, dx - other.x);
        dx += Math.cos(angle) * push;
        dy += Math.sin(angle) * push;
      }
    }
  }

  list[index] = { ...list[index], x: round1(dx), y: round1(dy) };
  patch({ magnetPlacement: 'manual', magnets: list });
  syncMagnetHandles();
}

/** Rotation applies in both placement modes — the builder reads it either way. */
function setMagnetRotation(index: number, deg: number) {
  const list = s().magnetPlacement === 'manual' ? s().magnets.map((m) => ({ ...m })) : seedManualPositions();
  while (list.length <= index) list.push({ x: 0, y: 0, rotation: 0 });
  list[index] = { ...list[index], rotation: deg };
  patch({ magnets: list });
  syncMagnetHandles();
}

function addMagnet() {
  const v = s();
  const n = Math.min(4, v.magnetCount + 1);
  if (n === v.magnetCount) return;
  activeMagnet = n - 1;

  if (v.magnetPlacement === 'manual') {
    const list = [...v.magnets];
    list.push({ x: 0, y: 0, rotation: 0 });
    patch({ magnetCount: n, magnets: list });
    // Push it away from overlapping at 0,0
    moveMagnetTo(n - 1, 0, 0);
  } else {
    patch({ magnetCount: n, magnetPlacement: 'auto', magnets: [] });
  }
  enterMagnetMode();
  redrawMagnetSection();
}

function removeMagnet(index: number) {
  const v = s();
  if (v.magnetCount <= 1) return;
  const magnets = v.magnets.filter((_, i) => i !== index);
  activeMagnet = Math.max(0, Math.min(activeMagnet, v.magnetCount - 2));
  patch({ magnetCount: v.magnetCount - 1, magnets });
  redrawMagnetSection();
}

/** Put the stage into Magnet mode looking at the back, where the pockets are. */
function enterMagnetMode() {
  if (store.get().editMode !== 'magnet') {
    store.set({ editMode: 'magnet', selectedRegions: [] });
    viewer.clearHighlight();
    syncEditMode();
    syncExtrudePanel();
  }
  if (s().magnetMode !== 'none') setView('back');
  syncMagnetHandles();
}

let draggingMagnet: number | null = null;

stageContainer.addEventListener('pointerdown', (e) => {
  if (store.get().editMode !== 'magnet' || e.button !== 0) return;
  const report = store.get().report;
  const v = store.get().settings;
  const isHelper = v.magnetMode === 'none' && v.sheetHelperEnabled;
  if (!isHelper && (!report || report.positions.length === 0)) return;
  const grabbed = viewer.handleAt(e.clientX, e.clientY);
  const point = viewer.pickBodyPoint(e.clientX, e.clientY);
  if (grabbed !== null) {
    activeMagnet = grabbed;
  } else if (point) {
    // Clicking bare shape sends the selected magnet there.
    const maxIndex = isHelper ? 0 : report!.positions.length - 1;
    activeMagnet = Math.min(activeMagnet, maxIndex);
    moveMagnetTo(activeMagnet, point[0], point[1]);
  } else {
    return;
  }
  draggingMagnet = activeMagnet;
  stageContainer.setPointerCapture(e.pointerId);
  stageContainer.classList.add('mg-dragging');
  syncMagnetHandles();
  redrawMagnetSection(); // the chip selection follows the grab
});

stageContainer.addEventListener('pointermove', (e) => {
  if (draggingMagnet === null) return;
  const point = viewer.pickBodyPoint(e.clientX, e.clientY);
  if (point) moveMagnetTo(draggingMagnet, point[0], point[1]);
});

const endMagnetDrag = (e: PointerEvent) => {
  if (draggingMagnet === null) return;
  draggingMagnet = null;
  stageContainer.classList.remove('mg-dragging');
  if (stageContainer.hasPointerCapture(e.pointerId)) stageContainer.releasePointerCapture(e.pointerId);
  redrawMagnetSection(); // manual placement may have just turned on
};
stageContainer.addEventListener('pointerup', endMagnetDrag);
stageContainer.addEventListener('pointercancel', endMagnetDrag);

new MutationObserver(() => {
  viewer.setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

// ---------------------------------------------------------------------------
// Geometry worker
// ---------------------------------------------------------------------------
const worker = new Worker(new URL('./workers/geometry.worker.ts', import.meta.url), { type: 'module' });

/** One build at a time; parameter changes during a build collapse into a single
 *  follow-up. Dragging a slider must never queue 40 CSG jobs. */
let buildInFlight = false;
let buildDirty = false;
let rebuildTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleRebuild(delay = 90) {
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    rebuild();
  }, delay);
}

worker.onmessage = (e: MessageEvent<GeometryResponse>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'ready':
      void loadDefaultImage();
      break;
    case 'parts': {
      buildInFlight = false;
      latestParts = msg.parts;
      viewer.setParts(msg.parts, refitNext);
      refitNext = false;
      store.set({
        building: false,
        hasParts: msg.parts.length > 0,
        status: '',
        warnings: msg.warnings ?? [],
        report: msg.magnet,
        selectedRegions: store.get().selectedRegions.filter((r) => r < s().palette.length),
      });
      syncExtrudePanel();
      syncMagnetHandles();
      if (buildDirty) {
        buildDirty = false;
        rebuild();
      } else {
        if (!firstBuildDone) {
          firstBuildDone = true;
          resetHistory();
        }
        maybeOfferWizard();
      }
      break;
    }
    case 'error':
      buildInFlight = false;
      buildDirty = false;
      store.set({ building: false, status: 'Error: ' + msg.message.split('\n')[0] });
      console.error('[geometry worker]', msg.message);
      break;
  }
};
worker.onerror = (e) => {
  buildInFlight = false;
  store.set({ building: false, status: 'Worker failed: ' + e.message });
  console.error(e);
};

// ---------------------------------------------------------------------------
// Image pipeline: source -> regions -> worker
// ---------------------------------------------------------------------------
/** Clone before tracing — processImage mutates its input. */
const cloneImage = (img: RgbaImage): RgbaImage => ({
  data: new Uint8ClampedArray(img.data),
  width: img.width,
  height: img.height,
});

/** First model: the default sample, straight in without the wizard so the app
 *  opens with something rendered. */
async function loadDefaultImage() {
  try {
    const first = SAMPLES[0];
    baseImage = await loadUrlToImage(first.src);
    preprocess = { ...DEFAULT_PREPROCESS };
    originalImage = baseImage;
    svgText = null;
    store.set({ settings: { ...s(), sourceName: first.name } });
    reprocess(true);
  } catch (err) {
    store.set({ status: 'Failed to load stock image: ' + String(err) });
  }
}

/** Every user-driven image import — upload or sample click — goes through the
 *  preprocessing wizard, the same as the clicker. */
function openImport(name: string, getter: () => Promise<RgbaImage>) {
  store.set({ building: true, status: 'Reading image…' });
  getter()
    .then((img) => {
      store.set({ building: false, status: '' });
      runImportWizard({
        baseImage: img,
        initial: preprocess,
        onCancel: () => store.set({ status: store.get().hasParts ? 'Ready.' : '' }),
        onComplete: ({ adjusted, preprocess: p }) => {
          baseImage = img;
          preprocess = p;
          originalImage = adjusted;
          svgText = null;
          store.set({ settings: { ...s(), sourceName: name, removeBg: !p.keepBackground } });
          reprocess(true);
        },
      });
    })
    .catch((err) => {
      store.set({ building: false, status: '' });
      // Carry the underlying reason. "Could not read that image" alone is
      // unactionable and unreproducible after the fact.
      const why = err instanceof Error ? err.message : String(err);
      toast(`Could not read that image — ${why}`, { kind: 'error' });
      console.error(err);
    });
}

async function importSvgFile(file: File) {
  try {
    svgText = await file.text();
    originalImage = null;
    baseImage = null;
    store.set({ settings: { ...s(), sourceName: file.name } });
    reprocess(true);
  } catch (err) {
    toast('Could not read that SVG', { kind: 'error' });
    console.error(err);
  }
}

function reprocess(refit = false) {
  const v = s();
  if (refit) {
    // A refit means a new source image — undoing back across it would apply the
    // old design's settings to a different picture.
    refitNext = true;
    if (firstBuildDone) resetHistory();
  }
  try {
    if (originalImage) {
      store.set({ building: true, status: 'Tracing image…' });
      regionSet = processImage(cloneImage(originalImage), v.colorCount, { removeBg: v.removeBg, smoothing: v.smoothing });
    } else if (svgText) {
      store.set({ building: true, status: 'Parsing SVG…' });
      regionSet = parseSvg(svgText, { removeBg: v.removeBg });
    } else {
      store.set({ status: 'Import an image or SVG first.' });
      return;
    }
  } catch (err) {
    store.set({ building: false, status: 'Error: ' + (err as Error).message });
    console.error(err);
    return;
  }

  if (!regionSet || regionSet.regions.length === 0) {
    store.set({ building: false, status: 'No shape found in that image.' });
    return;
  }

  const cur = s();
  // A NEW image gets the colours the tracer just detected. Carrying the old
  // palette across by index is what made every import render in the first
  // image's colours — a black-and-white logo turned every photo monochrome.
  // Within one image, a deliberate recolour survives a re-trace; a default does not.
  const palette = regionSet.regions.map((r, i) => {
    const prev = refit ? undefined : cur.palette[i];
    return {
      quantRgb: r.quantRgb,
      filamentRgb: prev?.userSet ? prev.filamentRgb : r.quantRgb,
      userSet: prev?.userSet ?? false,
      level: clamp(prev?.level ?? 0, 0, MAX_LEVEL),
    };
  });
  // Per-shape overrides are keyed by `inlay-<region>-<part>`, and a re-trace
  // renumbers those parts — a kept override would land on a different shape.
  // Colour-count and smoothing changes re-trace too, so this can't be limited
  // to new imports.
  store.set({ settings: { ...cur, palette, componentColors: {} }, selectedRegions: [] });
  rebuild();
}

function rebuild() {
  if (!regionSet || regionSet.regions.length === 0) return;
  if (buildInFlight) {
    buildDirty = true;
    return;
  }
  const v = s();

  const regions: BuildRegion[] = [];
  const componentHeights: Record<string, number> = {};
  regionSet.regions.forEach((r, i) => {
    const baseColor = v.palette[i]?.filamentRgb ?? r.quantRgb;
    const level = v.palette[i]?.level ?? 0;
    r.components.forEach((comp, j) => {
      const partName = `inlay-${i}-${j}`;
      // A per-shape override wins over its palette row.
      const color = v.componentColors[partName] ?? baseColor;
      regions.push({ filamentRgb: color, coverage: r.coverage, rings: comp.rings, partName });
      componentHeights[partName] = level;
    });
  });

  const params: MagnetBuildParams = {
    baseShape: v.baseShape,
    fitSizeMm: v.fitSizeMm,
    thickness: Math.max(1, v.thickness),
    imageMargin: v.imageMargin,
    cornerRadius: v.cornerRadius,
    edgeStyle: v.bevelEdge ? 'bevel' : 'flat',
    edgeRadius: v.bevelSize,
    bodyRgb: v.bodyRgb,
    colorBleed: v.colorBleed,
    stepHeight: v.stepHeight,
    componentHeights,
    extrudeChamfer: v.extrudeChamfer,
    magnetMode: v.magnetMode,
    magnetShape: v.magnetShape,
    magnetDiameter: v.magnetDiameter,
    magnetX: v.magnetX,
    magnetY: v.magnetY,
    magnetDepth: v.magnetDepth,
    backWall: v.backWall,
    magnetCount: v.magnetCount,
    pocketFit: v.pocketFit,
    pocketProfile: v.pocketProfile,
    sheetHelperEnabled: v.sheetHelperEnabled,
    magnetPlacement: v.productType === 'slider' ? 'auto' : v.magnetPlacement,
    magnets: v.productType === 'slider' ? [] : v.magnets,
    productType: v.productType,
    sliderLayout: v.sliderLayout,
    sliderMirrorBlank: v.sliderMirrorBlank,
    sliderGap: v.sliderGap,
  };

  buildInFlight = true;
  store.set({ building: true, status: v.productType === 'slider' ? 'Building slider…' : 'Building magnet…' });
  // Slider overrides magnetCount from sliderLayout.
  if (v.productType === 'slider') params.magnetCount = v.sliderLayout;
  const msg: GeometryRequest = { type: 'buildMagnet', regions, outline: regionSet.outline, params };
  worker.postMessage(msg);
}

const debounce = (fn: () => void, ms: number) => {
  let t: ReturnType<typeof setTimeout> | undefined;
  return () => {
    clearTimeout(t);
    t = setTimeout(fn, ms);
  };
};
const debouncedReprocess = debounce(() => reprocess(), 250);

// ---------------------------------------------------------------------------
// Export (single path — invariant 8)
// ---------------------------------------------------------------------------
async function exportModel(formatId: string) {
  if (latestParts.length === 0) throw new Error('Nothing to export yet');
  const v = s();
  const prefix = v.productType === 'slider' ? 'slider' : 'magnet';
  const stem = `${prefix}-${Math.round(v.fitSizeMm)}mm`;
  if (formatId === '3mf') downloadThreeMF(latestParts, `${stem}.3mf`);
  else throw new Error('Unknown format: ' + formatId);

  downloads += 1;
  if (downloads === 1) openLicenseModal();
  else licenseReminderToast();
}

// ---------------------------------------------------------------------------
// Right panel — Import Source
// ---------------------------------------------------------------------------
function importSourceSection(): HTMLElement {
  const sec = el('div', { className: 'vl-section' });
  sec.innerHTML = `
    <p class="vl-label">Import Source</p>
    <div class="import-grid" id="mgImportTabs">
      <button class="import-card active" data-mode="image" type="button">
        <span class="card-icon">${IMG_ICON}</span>
        <span class="card-label">Image</span>
      </button>
      <button class="import-card" data-mode="svg" type="button">
        <span class="card-icon">${SVG_ICON}</span>
        <span class="card-label">SVG</span>
      </button>
    </div>
    <div id="imagePanel" class="mode-panel">
      <div class="drop" id="mgDrop">
        <span class="drop-icon">${UPLOAD_ICON}</span>
        <div class="drop-title">Upload image</div>
        <div class="drop-text">Drop an image, or <u>click to browse</u></div>
        <span class="drop-note">PNG with transparency works best</span>
      </div>
      <input type="file" id="mgFile" accept="image/png,image/jpeg,image/webp" hidden />
      <span class="sample-heading">Choose a sample image</span>
      <div class="sample-inline-grid" id="mgSampleGrid"></div>
    </div>
    <div id="svgPanel" class="mode-panel" hidden>
      <p class="hint-text">Drop or upload SVG vector files. Color paths map to colors.</p>
      <label class="upload-cta">
        <span>${UPLOAD_ICON}</span>
        Upload SVG file(s)
        <input id="mgSvgUpload" type="file" accept=".svg,image/svg+xml" multiple />
      </label>
    </div>
  `;

  const $ = <T extends HTMLElement>(sel: string) => sec.querySelector<T>(sel)!;
  const tabs = $('#mgImportTabs');
  const imagePanel = $('#imagePanel');
  const svgPanel = $('#svgPanel');
  const drop = $('#mgDrop');
  const file = $<HTMLInputElement>('#mgFile');
  const svgFile = $<HTMLInputElement>('#mgSvgUpload');

  const setMode = (mode: 'image' | 'svg') => {
    tabs.querySelectorAll('.import-card').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-mode') === mode);
    });
    imagePanel.hidden = mode !== 'image';
    svgPanel.hidden = mode !== 'svg';
  };
  tabs.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('[data-mode]') as HTMLElement | null;
    if (t) setMode(t.getAttribute('data-mode') === 'svg' ? 'svg' : 'image');
  });

  drop.addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (f) openImport(f.name, () => loadFileToImage(f));
    file.value = ''; // re-picking the same file must still fire
  });
  svgFile.addEventListener('change', () => {
    for (const f of Array.from(svgFile.files ?? [])) void importSvgFile(f);
    svgFile.value = '';
  });

  // Drag & drop — on the zone and anywhere in the window.
  for (const evt of ['dragenter', 'dragover'] as const) {
    drop.addEventListener(evt, (e) => {
      e.preventDefault();
      drop.classList.add('over');
    });
  }
  for (const evt of ['dragleave', 'drop'] as const) {
    drop.addEventListener(evt, () => drop.classList.remove('over'));
  }
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    if (f.name.toLowerCase().endsWith('.svg')) {
      setMode('svg');
      void importSvgFile(f);
    } else if (f.type.startsWith('image/')) {
      setMode('image');
      openImport(f.name, () => loadFileToImage(f));
    }
  });

  const grid = $('#mgSampleGrid');
  for (const sample of SAMPLES) {
    const item = el('div', { className: 'sample-inline-item' }, [
      el('img', { attrs: { src: sample.src, alt: sample.name, loading: 'lazy' } }),
      el('span', { text: sample.name }),
    ]);
    item.addEventListener('click', () => openImport(sample.name, sample.load));
    grid.append(item);
  }

  // Background removal sits with the import, same as the clicker. Re-tuning the
  // image is done by re-importing it — the wizard opens on every import, so a
  // separate "adjust" button is one control too many.
  sec.append(
    toggleSwitch({
      label: 'Remove background',
      checked: s().removeBg,
      help: 'Drops a flat background so only the subject is traced. Turn off if your image is already cut out.',
      onChange: (on) => {
        patchImage({ removeBg: on });
        debouncedReprocess();
      },
    }),
  );

  return sec;
}

// ---------------------------------------------------------------------------
// Left panel — 1 · Shape & size
// ---------------------------------------------------------------------------
function shapeSection(): HTMLElement {
  const cornerRow = sliderRow({
    label: 'Corner radius',
    min: 0,
    max: 20,
    step: 0.5,
    value: s().cornerRadius,
    unit: 'mm',
    help: 'Rounding on the Rounded base shape.',
    onInput: (v) => patch({ cornerRadius: v }),
  });
  const sizeNote = el('p', { className: 'vl-hint' });
  const sizeRow = sliderRow({
    label: 'Size',
    min: 20,
    max: 120,
    value: s().fitSizeMm,
    unit: 'mm',
    help: 'Longest side of the magnet body.',
    onInput: (v) => patch({ fitSizeMm: v }),
  });
  const sizeRange = sizeRow.querySelector<HTMLInputElement>('input[type="range"]')!;
  const sizeVal = sizeRow.querySelector<HTMLInputElement>('.vl-val')!;

  const bevelRow = sliderRow({
    label: 'Bevel size',
    min: 0.2,
    max: 2,
    step: 0.1,
    value: s().bevelSize,
    unit: 'mm',
    help: 'How far the bevel cuts into the front rim.',
    onInput: (v) => patch({ bevelSize: v }),
  });

  const thicknessNote = el('p', { className: 'vl-hint' });
  const thicknessRow = sliderRow({
    label: 'Thickness',
    min: 1.5,
    max: 8,
    step: 0.1,
    value: s().thickness,
    unit: 'mm',
    help: 'Body height. Never goes below what the magnet needs — the slider snaps back if you try.',
    // enforceFit() raises it back to the minimum; the sync below writes that
    // corrected value into the slider, so the user sees the floor immediately.
    onInput: (v) => patch({ thickness: v }),
  });
  const thicknessRange = thicknessRow.querySelector<HTMLInputElement>('input[type="range"]')!;
  const thicknessVal = thicknessRow.querySelector<HTMLInputElement>('.vl-val')!;

  const syncVisibility = () => {
    const v = s();
    cornerRow.classList.toggle('hidden', v.baseShape !== 'roundedRect' && v.baseShape !== 'rectangle');
    bevelRow.classList.toggle('hidden', !v.bevelEdge);

    if (Number(thicknessRange.value) !== v.thickness) {
      thicknessRange.value = String(v.thickness);
      thicknessVal.value = `${v.thickness} mm`;
    }

    if (Number(sizeRange.value) !== v.fitSizeMm) {
      sizeRange.value = String(v.fitSizeMm);
      sizeVal.value = `${v.fitSizeMm} mm`;
    }

    const minS = v.productType === 'slider' ? sliderMinBodySize(v) : 0;
    if (v.productType === 'slider') {
      sizeNote.textContent = `Minimum ${minS.toFixed(1)} mm to fit ${v.sliderLayout} magnets per half.`;
      sizeNote.classList.remove('hidden');
    } else {
      sizeNote.textContent = '';
      sizeNote.classList.add('hidden');
    }

    const min = minThickness(v);
    thicknessNote.textContent =
      v.magnetMode === 'none'
        ? ''
        : `Minimum ${min.toFixed(1)} mm: ${v.magnetDepth.toFixed(1)} mm magnet` +
          (v.magnetMode === 'embedded'
            ? ` + ${clamp(v.backWall, BACK_WALL_MIN, BACK_WALL_MAX).toFixed(1)} mm back wall`
            : '') +
          ` + ${COVER_MIN} mm cover.`;
    thicknessNote.classList.toggle('hidden', v.magnetMode === 'none');
  };
  syncVisibility();
  ownSub(syncVisibility);

  return step(2, 'Shape & size', [
    selectField({
      label: 'Base shape',
      value: s().baseShape,
      help: 'Outline follows your image silhouette. The presets place the image on a shaped body.',
      options: [
        { value: 'outline', label: 'Image outline' },
        { value: 'circle', label: 'Circle' },
        { value: 'roundedRect', label: 'Rounded square' },
        { value: 'rectangle', label: 'Rectangle' },
        { value: 'square', label: 'Square' },
        { value: 'hexagon', label: 'Hexagon' },
      ],
      onChange: (v) => patch({ baseShape: v as BaseShapeKind }),
    }),
    sizeRow,
    sizeNote,
    thicknessRow,
    thicknessNote,
    sliderRow({
      label: 'Margin',
      min: 0.5,
      max: 5,
      step: 0.1,
      value: s().imageMargin,
      unit: 'mm',
      help: 'Flat frame between the image edge and the body edge.',
      onInput: (v) => patch({ imageMargin: v }),
    }),
    cornerRow,
    toggleSwitch({
      label: 'Bevel the front edge',
      checked: s().bevelEdge,
      help: 'Cuts a bevel around the top rim. The back stays flat so it sits against the fridge.',
      onChange: (on) => {
        patch({ bevelEdge: on });
        syncVisibility();
      },
    }),
    bevelRow,
  ]);
}

// ---------------------------------------------------------------------------
// Left panel — 2 · Colors & detail
// ---------------------------------------------------------------------------
function colorsSection(): HTMLElement {
  const pal = el('div', { className: 'palette' });

  const openChip = (chip: HTMLElement, currentHex: string, onSelect: (hex: string) => void) => {
    const rect = chip.getBoundingClientRect();
    showColorPopover(rect.left, rect.bottom + 6, currentHex, onSelect);
  };

  const renderPalette = () => {
    const cur = s();
    pal.replaceChildren();

    const bodyRow = el('div', { className: 'fil-row body-row' }, [
      el('span', { className: 'slot-no slot-body', text: 'Body' }),
      el('span', { className: 'swatch', attrs: { style: 'background:#787c82; opacity:0.5', title: 'default body color' } }),
      el('span', { className: 'arrow', text: '→' }),
      el('button', { className: 'fil-chip', attrs: { type: 'button', title: 'body color', style: `background:#${rgbToHex(cur.bodyRgb)}` } }),
    ]);
    (bodyRow.querySelector('.fil-chip') as HTMLButtonElement).addEventListener('click', (e) => {
      e.stopPropagation();
      openChip(e.currentTarget as HTMLButtonElement, `#${rgbToHex(s().bodyRgb)}`, (hex) => patch({ bodyRgb: hexToRgb(hex) }));
    });
    pal.append(bodyRow);

    if (cur.palette.length === 0) {
      pal.append(el('div', { className: 'hint', text: 'Load an image or vector to pick colors.' }));
      return;
    }

    cur.palette.forEach((entry, i) => {
      const row = el('div', { className: 'fil-row region-row' }, [
        el('span', { className: 'slot-no', text: String(i + 1) }),
        el('span', { className: 'swatch', attrs: { style: `background:#${rgbToHex(entry.quantRgb)}`, title: 'detected color' } }),
        el('span', { className: 'arrow', text: '→' }),
        el('button', { className: 'fil-chip', attrs: { type: 'button', title: 'filament', style: `background:#${rgbToHex(entry.filamentRgb)}` } }),
      ]);
      if (entry.level > 0) row.append(el('span', { className: 'lvl-badge', text: `Raised ${entry.level}` }));
      (row.querySelector('.fil-chip') as HTMLButtonElement).addEventListener('click', (e) => {
        e.stopPropagation();
        openChip(e.currentTarget as HTMLButtonElement, `#${rgbToHex(entry.filamentRgb)}`, (hex) =>
          patch({
            palette: s().palette.map((p, pi) =>
              pi === i ? { ...p, filamentRgb: hexToRgb(hex), userSet: true } : p,
            ),
            // The row governs its whole bucket, so it also resets any shapes in
            // that bucket the user had recoloured individually — otherwise the
            // swatch would visibly change and half the model wouldn't follow.
            componentColors: dropOverridesForRegion(s().componentColors, i),
          }),
        );
      });
      pal.append(row);
    });
    const overrides = Object.keys(cur.componentColors).length;
    if (overrides > 0) {
      const reset = el('button', {
        className: 'vl-btn vl-btn--ghost vl-btn--block',
        text: `Reset ${overrides} recoloured shape${overrides === 1 ? '' : 's'}`,
        attrs: { type: 'button', title: 'Put every individually recoloured shape back on its palette row' },
        on: { click: () => patch({ componentColors: {} }) },
      });
      pal.append(reset);
    }
    const slots = filamentSlotCount();
    if (slots > 4) {
      pal.append(
        el('p', {
          className: 'mg-warn',
          text: `This model uses ${slots} colours — more than a 4-slot AMS. Reuse a colour you already have, or the slicer will ask you to swap filament mid-print.`,
        }),
      );
    }
    pal.append(el('div', { className: 'hint model-recolor-tip', text: 'Tip: click any shape on the 3D model to recolor just that shape. The swatches above recolor every shape sharing that color.' }));
  };

  renderPalette();
  // componentColors is in the signature so the reset button and the slot warning
  // appear the moment a shape is recoloured on the model.
  let lastSig = JSON.stringify([s().palette, s().bodyRgb, s().componentColors]);
  ownSub(() => {
    const sig = JSON.stringify([s().palette, s().bodyRgb, s().componentColors]);
    if (sig === lastSig) return;
    lastSig = sig;
    renderPalette();
  });

  return step(3, 'Colors & detail', [
    selectField({
      label: 'Colors',
      value: String(s().colorCount),
      help: 'How many distinct colors the image is split into. Each becomes its own part in the 3MF.',
      options: Array.from({ length: 11 }, (_, i) => ({ value: String(i + 2), label: `${i + 2} colors` })),
      onChange: (v) => {
        patchImage({ colorCount: Number(v) });
        debouncedReprocess();
      },
    }),
    sliderRow({
      label: 'Smoothing',
      min: 0,
      max: 1,
      step: 0.05,
      value: s().smoothing,
      help: 'Simplifies the traced outlines. Higher gives cleaner edges; lower keeps fine detail.',
      onInput: (v) => {
        patchImage({ smoothing: v });
        debouncedReprocess();
      },
    }),
    pal,
  ]);
}

// ---------------------------------------------------------------------------
// Left panel — 3 · Magnet (the differentiator)
// ---------------------------------------------------------------------------
function magnetSection(): HTMLElement {
  const body = el('div', { className: 'mg-magnet' });
  const fitReport = el('div', { className: 'mg-report' });
  const warnBox = el('div', { className: 'mg-warnings' });

  /** Rebuilt only when the shape of the form changes (mode / magnet type /
   *  count), never on a value tick — otherwise typing into a field would
   *  destroy the field under the cursor. */
  let formSig = '';
  /** Force a redraw when values changed underneath the controls (presets, wizard). */
  const redrawForm = () => {
    formSig = '';
    renderForm();
  };

  const renderForm = () => {
    const v = s();
    const sig = [v.productType, v.magnetMode, v.magnetShape, v.magnetCount, v.magnetPlacement, v.sliderLayout, v.sliderMirrorBlank].join('|');
    if (sig === formSig) return;
    formSig = sig;

    // --- Product type selector (always shown) ---
    const productType = segmentedControl<ProductType>({
      label: 'Product',
      value: v.productType,
      options: [
        { value: 'magnet', label: 'Fridge magnet' },
        { value: 'slider', label: 'Magnetic slider' },
      ],
      onChange: (val) => {
        if (val === 'slider') {
          switchToSlider();
          return;
        }
        patch({ productType: val });
        renderForm();
      },
    });

    const mode = segmentedControl<MagnetMode>({
      label: 'How it sticks',
      value: v.magnetMode,
      options: [
        { value: 'glue-on', label: 'Glue-on' },
        { value: 'embedded', label: 'Embedded' },
        { value: 'none', label: 'Sheet' },
      ],
      onChange: (val) => {
        patch({ magnetMode: val });
        renderForm();
        if (val !== 'none') enterMagnetMode();
      },
    });

    const setupBtn = el('button', {
      className: 'vl-btn vl-btn--ghost vl-btn--block',
      text: 'Not sure? Walk me through it',
      attrs: { type: 'button' },
      on: { click: () => void runWizard() },
    });

    if (v.magnetMode === 'none') {
      const helperToggle = toggleSwitch({
        label: 'Show visual helper for magnetic sheet',
        checked: v.sheetHelperEnabled,
        onChange: (val) => {
          patch({ sheetHelperEnabled: val });
          syncMagnetHandles();
          redrawForm();
        },
      });
      const helperHint = el('p', {
        className: 'vl-hint',
        text: 'This is just a visual helper to check if your sticker fits. It will not cut a pocket into the 3D model.',
      });

      const helperDims = el('div', { className: 'mg-dims' }, [
        numberField({
          label: 'Width', value: v.magnetX, min: 3, max: 200, step: 0.5, unit: 'mm',
          onChange: (val) => { patch({ magnetX: val }); syncMagnetHandles(); },
        }),
        numberField({
          label: 'Length', value: v.magnetY, min: 3, max: 200, step: 0.5, unit: 'mm',
          onChange: (val) => { patch({ magnetY: val }); syncMagnetHandles(); },
        }),
      ]);

      const helperRotation = sliderRow({
        label: 'Rotate sheet',
        min: 0,
        max: 355,
        step: 5,
        value: v.magnets[0]?.rotation ?? 0,
        unit: '°',
        help: 'Turn the visual helper to match your sticker orientation.',
        onInput: (deg) => { setMagnetRotation(0, deg); },
      });

      // The product selector has to stay on screen — without it, picking Sheet
      // was a one-way door out of slider mode.
      const content = [productType, mode, modeHint('none')];
      content.push(helperToggle);
      if (v.sheetHelperEnabled) {
        content.push(helperHint, helperDims, helperRotation);
      }
      content.push(setupBtn);
      
      body.replaceChildren(...content);
      return;
    }

    const isDisc = v.magnetShape === 'disc';

    const shape = segmentedControl<MagnetShapeKind>({
      label: 'Magnet type',
      value: v.magnetShape,
      options: [
        { value: 'disc', label: 'Disc' },
        { value: 'block', label: 'Block' },
      ],
      onChange: (val) => {
        patch({ magnetShape: val });
        renderForm();
      },
    });

    const preset = selectField({
      label: 'Common sizes',
      value: currentPresetId(v),
      help: 'Stock magnet sizes. Picking one fills in the dimensions below.',
      options: [
        { value: 'custom', label: 'Custom…' },
        ...MAGNET_PRESETS.filter((p) => p.shape === v.magnetShape).map((p) => ({ value: p.id, label: p.label })),
      ],
      onChange: (id) => {
        const p = MAGNET_PRESETS.find((x) => x.id === id);
        if (!p) return;
        patch(
          p.shape === 'disc'
            ? { magnetDiameter: p.diameter!, magnetDepth: p.height }
            : { magnetX: p.x!, magnetY: p.y!, magnetDepth: p.height },
        );
        redrawForm(); // the dimension fields below have new values
      },
    });

    const dims = el('div', { className: 'mg-dims' }, isDisc
      ? [
          numberField({
            label: 'Diameter', value: v.magnetDiameter, min: 3, max: 40, step: 0.5, unit: 'mm',
            onChange: (val) => patch({ magnetDiameter: val }),
          }),
          numberField({
            label: 'Height', value: v.magnetDepth, min: 0.5, max: 6, step: 0.5, unit: 'mm',
            onChange: (val) => patch({ magnetDepth: val }),
          }),
        ]
      : [
          numberField({
            label: 'Width', value: v.magnetX, min: 3, max: 60, step: 0.5, unit: 'mm',
            onChange: (val) => patch({ magnetX: val }),
          }),
          numberField({
            label: 'Length', value: v.magnetY, min: 3, max: 60, step: 0.5, unit: 'mm',
            onChange: (val) => patch({ magnetY: val }),
          }),
          numberField({
            label: 'Height', value: v.magnetDepth, min: 0.5, max: 6, step: 0.5, unit: 'mm',
            onChange: (val) => patch({ magnetDepth: val }),
          }),
        ]);

    // --- Magnets on the design: chips you can add to, remove and select. The
    //     model itself is the placement tool, so this stays a short list. ---
    const magnetsBlock = el('div', { className: 'mg-block' }, [
      el('span', { className: 'vl-control-label', text: 'Magnets on this design' }),
      magnetChips(),
      el('p', {
        className: 'vl-hint',
        text:
          v.magnetPlacement === 'auto'
            ? 'Placed automatically. Drag one on the model to put it exactly where you want.'
            : 'You placed these. Drag them on the model to adjust.',
      }),
    ]);

    if (!isDisc) {
      magnetsBlock.append(
        sliderRow({
          label: `Rotate magnet ${activeMagnet + 1}`,
          min: 0,
          max: 355,
          step: 5,
          value: v.magnets[activeMagnet]?.rotation ?? 0,
          unit: '°',
          help: 'Turn the selected block magnet. Discs are round, so this only applies to blocks.',
          onInput: (deg) => setMagnetRotation(activeMagnet, deg),
        }),
      );
    }

    if (v.magnetPlacement === 'manual') {
      magnetsBlock.append(
        el('button', {
          className: 'vl-btn vl-btn--secondary vl-btn--block',
          text: 'Reset to automatic placement',
          attrs: { type: 'button' },
          on: {
            click: () => {
              activeMagnet = 0;
              patch({ magnetPlacement: 'auto', magnets: [] });
              redrawForm();
            },
          },
        }),
      );
    }

    // --- Fine tuning: correct defaults, hidden until wanted. ---
    const tuning: HTMLElement[] = [];
    if (isDisc) {
      tuning.push(
        selectField({
          label: 'Pocket shape',
          value: v.pocketProfile,
          help: 'Hex pockets print with flat walls (no round-hole shrinkage) and leave corner gaps for glue. Round matches the magnet exactly.',
          options: [
            { value: 'round', label: 'Round — matches the magnet' },
            { value: 'hex', label: 'Hex — easier to print, grips better' },
          ],
          onChange: (val) => patch({ pocketProfile: val as PocketProfile }),
        }),
      );
    }
    tuning.push(
      sliderRow({
        label: 'Press-fit gap',
        min: 0,
        max: 1,
        step: 0.05,
        value: v.pocketFit,
        unit: 'mm',
        help: `Added to the magnet's ${v.magnetShape === 'disc' ? 'diameter' : 'width and length'}, not its radius — a ⌀6 magnet with 0.2 mm gets a ⌀6.2 socket. Raise it if your magnets won't go in, drop it toward 0 for a tighter grip.`,
        onInput: (val) => patch({ pocketFit: val }),
      }),
    );
    if (v.magnetMode === 'embedded') {
      tuning.push(
        sliderRow({
          label: 'Back wall',
          min: BACK_WALL_MIN,
          max: BACK_WALL_MAX,
          step: 0.1,
          value: v.backWall,
          unit: 'mm',
          help: 'Material between the magnet and the fridge. Thinner holds better; 0.8 mm is a good balance.',
          onInput: (val) => {
            patch({ backWall: val });
            syncReport();
          },
        }),

      );
    }
    const tuningDetails = el('details', { className: 'mg-details' }, [
      el('summary', { text: 'Fine tuning' }),
      el('div', { className: 'mg-details__body' }, tuning),
    ]);

    // --- Slider-specific controls ---
    const isSlider = v.productType === 'slider';
    const grid = isSlider ? sliderGrid(v) : null;

    const sliderLayoutCtrl = isSlider ? segmentedControl<string>({
      label: 'Magnets per half',
      value: String(v.sliderLayout),
      help: 'Two columns, stacked in rows along the slide axis. More rows = longer travel and more clicks.',
      options: [
        { value: '4', label: '4 · 2×2' },
        { value: '6', label: '6 · 2×3' },
        { value: '8', label: '8 · 2×4' },
      ],
      onChange: (val) => {
        const layout = Number(val) as SliderLayout;
        patch({ sliderLayout: layout, magnetCount: layout });
        renderForm();
      },
    }) : null;

    // The pitch between rows IS the click distance, so this slider is the one
    // control that changes how the finished toy feels in the hand. Packed at the
    // 2 mm printable minimum the pockets read as one solid block.
    const sliderGapCtrl = isSlider ? sliderRow({
      label: 'Magnet spacing',
      min: 0,
      max: 12,
      step: 0.5,
      value: v.sliderGap,
      unit: 'mm',
      help: 'Plastic between the pockets, on top of the 2 mm minimum. Wider spacing means a longer throw between clicks — and a bigger body.',
      onInput: (val) => {
        patch({ sliderGap: val });
        syncReport();
      },
    }) : null;

    const sliderBlankToggle = isSlider ? toggleSwitch({
      label: 'Blank second piece',
      checked: v.sliderMirrorBlank,
      help: 'When on, the second half is a plain slab with magnet pockets — no image, no colour changes.',
      onChange: (on) => patch({ sliderMirrorBlank: on }),
    }) : null;

    // Slider mode drops "Sheet" — there is nothing to stick to — but hiding the
    // choice entirely and silently forcing glue-on was its own confusion.
    const sliderMode = isSlider ? segmentedControl<MagnetMode>({
      label: 'How the magnets go in',
      value: v.magnetMode === 'embedded' ? 'embedded' : 'glue-on',
      options: [
        { value: 'glue-on', label: 'Glue-on' },
        { value: 'embedded', label: 'Embedded' },
      ],
      onChange: (val) => {
        patch({ magnetMode: val });
        renderForm();
      },
    }) : null;

    const sliderModeHint = isSlider ? el('p', {
      className: 'vl-hint',
      text: v.magnetMode === 'embedded'
        ? 'Sealed under a thin wall — no glue, but that wall sits between the magnets and softens the click.'
        : 'Pockets open on the sliding face. Glue each magnet in flush. This is what most sliders do.',
    }) : null;

    // Deliberately no numbers here — pitch, travel and click count live in the
    // report below, which updates on every tick of the spacing slider.
    const sliderHint = isSlider ? el('p', {
      className: 'vl-hint',
      text:
        'Two identical pieces that slide along the long axis. Print both, drop the magnets in with ' +
        'alternating polarity, and flip one over to assemble.',
    }) : null;

    // The one thing people get wrong when they assemble a slider, spelled out.
    const sliderPolarity = isSlider ? el('details', { className: 'mg-details' }, [
      el('summary', { text: 'How to insert the magnets' }),
      el('div', { className: 'mg-details__body' }, [
        el('p', {
          className: 'vl-hint',
          text:
            'Both halves are the same print — you flip one over to assemble, so the image still reads the right way round.',
        }),
        el('p', {
          className: 'vl-hint',
          text:
            'Polarity is the whole trick. Take a stack of magnets and drop them into each column one at a time, ' +
            'flipping every second one so the poles alternate N-S-N-S up the column. Do both halves the same way. ' +
            'That alternation is what makes it click instead of just grabbing.',
        }),
        el('p', {
          className: 'vl-hint',
          text: 'Glue each magnet flush with the face, let it cure, then rub the two faces together to break them in.',
        }),
      ]),
    ]) : null;

    // Real fidget sliders are built around small discs; a ⌀12 magnet makes a
    // brick that snaps shut instead of sliding.
    const sliderMagnetWarn =
      isSlider && v.magnetShape === 'disc' && v.magnetDiameter > 8
        ? el('p', {
            className: 'mg-warn',
            text: `⌀${v.magnetDiameter} mm is very strong for a slider — it will clamp rather than glide. ⌀5–8 mm is the usual range.`,
          })
        : null;

    // Read top to bottom, the slider form now answers one question per block:
    // what am I making → what magnet do I own → how is the array laid out →
    // how do the magnets go in → how do I put it together.
    body.replaceChildren(
      productType,
      ...(isSlider ? [sliderHint!] : [mode, modeHint(v.magnetMode)]),
      el('div', { className: 'mg-block' }, [
        el('span', { className: 'vl-control-label', text: 'Your magnet' }),
        shape,
        preset,
        dims,
        ...(sliderMagnetWarn ? [sliderMagnetWarn] : []),
      ]),
      ...(isSlider
        ? [
            el('div', { className: 'mg-block' }, [
              el('span', { className: 'vl-control-label', text: 'The magnet array' }),
              sliderLayoutCtrl!,
              sliderGapCtrl!,
            ]),
            el('div', { className: 'mg-block' }, [
              el('span', { className: 'vl-control-label', text: 'Assembly' }),
              sliderMode!,
              sliderModeHint!,
              sliderBlankToggle!,
              sliderPolarity!,
            ]),
          ]
        : // Magnet chips only for fridge magnet mode
          [magnetsBlock]),
      tuningDetails,
      setupBtn,
    );
  };

  /** One plain sentence describing the chosen attachment. */
  function modeHint(mode: MagnetMode): HTMLElement {
    const text =
      mode === 'glue-on'
        ? 'A pocket opens at the back. Print it, drop the magnet in, glue it. Strongest hold.'
        : mode === 'embedded'
          ? 'Sealed inside. Your printer pauses once, you drop the magnet in, and it closes over.'
          : 'Flat back, no pocket — stick the print onto adhesive magnetic sheet.';
    return el('p', { className: 'vl-hint', text });
  }

  /** The magnet list: select, add, remove. Placement itself happens on the model. */
  function magnetChips(): HTMLElement {
    const v = s();
    const row = el('div', { className: 'mg-chips' });

    for (let i = 0; i < v.magnetCount; i++) {
      const selected = i === activeMagnet;
      const chip = el('button', {
        className: `mg-chip${selected ? ' active' : ''}`,
        attrs: { type: 'button', 'aria-pressed': String(selected), title: `Select magnet ${i + 1}` },
        on: {
          click: () => {
            activeMagnet = i;
            enterMagnetMode();
            redrawForm();
          },
        },
      }, [el('span', { text: `${i + 1}` })]);

      if (v.magnetCount > 1) {
        chip.append(
          el('span', {
            className: 'mg-chip__x',
            text: '×',
            attrs: { role: 'button', 'aria-label': `Remove magnet ${i + 1}`, title: 'Remove' },
            on: {
              click: (e: Event) => {
                e.stopPropagation();
                removeMagnet(i);
              },
            },
          }),
        );
      }
      row.append(chip);
    }

    const addBtn = el('button', {
      className: 'mg-chip mg-chip--add',
      text: '+',
      attrs: { type: 'button', title: 'Add another magnet', 'aria-label': 'Add magnet' },
      on: { click: addMagnet },
    }) as HTMLButtonElement;
    addBtn.disabled = v.magnetCount >= 4;
    row.append(addBtn);

    return row;
  }

  /** The honest read-out: what the build actually produced, plus the pause info. */
  const syncReport = () => {
    const v = s();
    const report = store.get().report;
    const rows: HTMLElement[] = [];

    if (v.magnetMode === 'none') {
      fitReport.replaceChildren();
      fitReport.classList.add('hidden');
    } else {
      fitReport.classList.remove('hidden');
      const cover = report ? report.coverThickness : v.thickness - v.magnetDepth;
      const placed = report?.placed ?? v.magnetCount;
      if (v.productType === 'slider') {
        const g = sliderGrid(v);
        const perHalf = report?.sliderPerHalf ?? placed;
        const pitch = report?.sliderPitch ?? g.pitch;
        const clicks = report?.sliderClicks ?? g.clicks;
        const travel = report?.sliderTravel ?? g.travel;
        rows.push(
          reportRow('Magnets', perHalf === 0 ? 'none placed' : `${perHalf} per half · ${2 * perHalf} total`),
        );
        // Pitch and travel describe pockets that exist — don't quote a feel for a
        // slider the builder just refused to cut.
        if (perHalf > 0) {
          rows.push(reportRow('Click every', `${pitch.toFixed(1)} mm`));
          rows.push(reportRow('Travel', `${travel.toFixed(1)} mm · ${clicks} click${clicks === 1 ? '' : 's'}`));
        }
      } else {
        rows.push(reportRow('Pocket', `${(report?.pocketDepth ?? v.magnetDepth).toFixed(1)} mm deep · ${placed} of ${v.magnetCount}`));
      }
      // The number to check against the magnet in your hand. Lives here rather
      // than next to the Fit slider because this block re-renders on every tick.
      rows.push(
        reportRow(
          'Socket',
          v.magnetShape === 'disc'
            ? `⌀${(v.magnetDiameter + v.pocketFit).toFixed(1)} mm for a ⌀${v.magnetDiameter} mm magnet`
            : `${(v.magnetX + v.pocketFit).toFixed(1)} × ${(v.magnetY + v.pocketFit).toFixed(1)} mm for a ${v.magnetX} × ${v.magnetY} mm magnet`,
        ),
      );
      rows.push(reportRow('Over the magnet', `${cover.toFixed(1)} mm of body`));
      if (v.magnetMode === 'embedded') {
        const back = clamp(v.backWall, BACK_WALL_MIN, BACK_WALL_MAX);
        const pauseZ = back + (report?.pocketDepth ?? v.magnetDepth);
        const layer = Math.round(pauseZ / 0.2);
        rows.push(reportRow('Pause at', `${pauseZ.toFixed(2)} mm — layer ${layer}`));
        fitReport.replaceChildren(
          ...rows,
          el('p', {
            className: 'vl-hint',
            text: v.productType === 'slider'
              ? `Add a pause at layer ${layer} in each piece, drop the magnets in — alternating polarity up each column — and resume. They end up sealed under ${back.toFixed(1)} mm on the sliding face.`
              : `Add a pause at layer ${layer} in your slicer, drop the magnet in, and resume. It ends up sealed under ${cover.toFixed(1)} mm of body with ${back.toFixed(1)} mm against the fridge.`,
          }),
        );
      } else {
        fitReport.replaceChildren(
          ...rows,
          el('p', {
            className: 'vl-hint',
            text: v.productType === 'slider'
              ? 'The pockets open on the back — that face is the sliding face. Glue each magnet in flush, alternating polarity up each column.'
              : 'The pocket opens at the back — no pause needed. Glue the magnet in after printing.',
          }),
        );
      }
    }

    const warnings = store.get().warnings;
    warnBox.replaceChildren(
      ...warnings.map((w) => el('p', { className: 'mg-warn', text: w })),
    );
    warnBox.classList.toggle('hidden', warnings.length === 0);
  };

  const reportRow = (label: string, value: string) =>
    el('div', { className: 'mg-report__row' }, [
      el('span', { className: 'mg-report__label', text: label }),
      el('span', { className: 'mg-report__value', text: value }),
    ]);

  renderForm();
  syncReport();
  ownSub(syncReport);
  // Re-render the form when its signature changes underneath it — e.g. a stage
  // drag flipping placement to manual. No-op when the signature is unchanged, so
  // typing in a dimension field never rebuilds the field under the cursor.
  ownSub(renderForm);
  redrawMagnetSection = () => {
    redrawForm();
    syncReport();
  };

  const sec = step(1, 'Magnet', [body, fitReport, warnBox], true);
  sec.classList.add('mg-magnet-step');
  // The step is the product, so it should say which product. "1 · Magnet" over a
  // slider's controls is the small lie that makes the whole panel read wrong.
  const summary = sec.querySelector('summary')!;
  const syncTitle = () => {
    summary.textContent = s().productType === 'slider' ? '1 · Slider' : '1 · Magnet';
  };
  syncTitle();
  ownSub(syncTitle);
  return sec;
}

function currentPresetId(v: Settings): string {
  const match = MAGNET_PRESETS.find(
    (p) =>
      p.shape === v.magnetShape &&
      p.height === v.magnetDepth &&
      (p.shape === 'disc' ? p.diameter === v.magnetDiameter : p.x === v.magnetX && p.y === v.magnetY),
  );
  return match?.id ?? 'custom';
}

/** Rebuild the left settings panel — used after Undo/Redo, project load, and the
 *  wizard, where many controls change value at once. Open/closed state is kept,
 *  and the old sections' store subscriptions are dropped first. */
function rebuildSections() {
  const existing = shell.leftScroll.querySelectorAll('.vl-section.section-collapsible');
  const openState = Array.from(existing).map((node) => (node as HTMLDetailsElement).open);
  existing.forEach((node) => node.remove());
  while (sectionSubs.length) sectionSubs.pop()!();

  const rebuilt = [magnetSection(), shapeSection(), colorsSection()];
  rebuilt.forEach((sec, i) => {
    if (openState[i] !== undefined) (sec as HTMLDetailsElement).open = openState[i];
  });
  shell.leftScroll.append(...rebuilt);
}

// ---------------------------------------------------------------------------
// Wizard
// ---------------------------------------------------------------------------
async function runWizard() {
  const result = await openMagnetWizard({ shape: s().magnetShape });
  if (!result) return;
  const next: Partial<Settings> = { 
    magnetMode: result.mode,
    productType: result.productType,
  };
  if (result.sliderLayout) next.sliderLayout = result.sliderLayout;
  if (result.shape) next.magnetShape = result.shape;
  if (result.preset) {
    const p = result.preset;
    next.magnetDepth = p.height;
    if (p.shape === 'disc') next.magnetDiameter = p.diameter!;
    else {
      next.magnetX = p.x!;
      next.magnetY = p.y!;
    }
  }
  patch(next);
  // The wizard picks a product and a magnet but never a body, so a slider used
  // to land on the 70 mm image outline and warn immediately. Run it through the
  // same shape/size resolution the Product switch uses.
  if (result.productType === 'slider') {
    switchToSlider();
    return;
  }
  rebuildSections();
  if (result.mode !== 'none') setView('back');
}

let wizardOffered = false;
function maybeOfferWizard() {
  if (wizardOffered) return;
  wizardOffered = true;
  let seen = false;
  try {
    seen = localStorage.getItem(WIZARD_KEY) === '1';
  } catch { /* private mode */ }
  if (seen) return;
  try {
    localStorage.setItem(WIZARD_KEY, '1');
  } catch { /* private mode */ }
  void runWizard();
}

function showHelp() {
  dialog({
    title: 'Image to Fridge Magnet',
    content: el('div', { className: 'mg-help' }, [
      el('p', { text: 'Import a PNG/JPG or an SVG, or pick a sample. The image is traced into color regions and carved into the front face; the back stays flat so it sits against the fridge.' }),
      el('p', { text: 'Step 3 sets up the magnet. Glue-on cuts a pocket that opens at the back — print it, drop the magnet in, glue it. Embedded seals the magnet inside: your slicer pauses once at the layer we show you, you drop the magnet in, and the print closes over it. Magnetic sheet leaves the back flat with no pocket at all.' }),
      el('p', { text: 'Use the Back view to check the pockets. The body is never allowed to be thinner than the magnet needs, and pockets always keep a 2 mm wall to the edge.' }),
      el('p', { text: 'Export 3MF for a color print (each color is its own part) or STL for a single solid.' }),
    ]),
    actions: [{ label: 'Got it', primary: true }],
  });
}

// ---------------------------------------------------------------------------
// Floating filament + custom color picker, ported from the clicker
// ---------------------------------------------------------------------------
function showColorPopover(clientX: number, clientY: number, currentHex: string, onSelect: (hex: string) => void) {
  const popover = el('div', { className: 'color-popover' });
  document.body.appendChild(popover);

  let done = false;
  const close = () => {
    if (done) return;
    done = true;
    popover.remove();
    document.removeEventListener('mousedown', dismiss);
  };
  const dismiss = (e: MouseEvent) => {
    if (!popover.contains(e.target as Node)) close();
  };

  for (const [name, hex] of FILAMENTS) {
    const btn = el('button', { attrs: { type: 'button', title: name, style: `background:${hex}` } });
    if (hex.toLowerCase() === currentHex.toLowerCase()) btn.classList.add('active');
    btn.addEventListener('click', () => {
      onSelect(hex);
      close();
    });
    popover.append(btn);
  }

  const custom = el('label', { className: 'cp-custom', attrs: { title: 'Custom color' } });
  const inp = el('input', {
    attrs: { type: 'color', value: /^#[0-9a-f]{6}$/i.test(currentHex) ? currentHex : '#888888' },
    on: { input: () => onSelect(inp.value) },
  }) as HTMLInputElement;
  custom.append(inp);
  popover.append(custom);

  const w = popover.offsetWidth || 170;
  const h = popover.offsetHeight || 180;
  popover.style.left = `${Math.max(8, Math.min(clientX, window.innerWidth - w - 8))}px`;
  popover.style.top = `${Math.max(8, Math.min(clientY, window.innerHeight - h - 8))}px`;
  setTimeout(() => document.addEventListener('mousedown', dismiss), 50);
}

// ---------------------------------------------------------------------------
// Save / Load
// ---------------------------------------------------------------------------
function rgbaToDataUrl(img: RgbaImage): string {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  const data = ctx.createImageData(img.width, img.height);
  data.data.set(img.data);
  ctx.putImageData(data, 0, 0);
  return canvas.toDataURL('image/png');
}

function saveProject() {
  const project = {
    v: 2,
    settings: s(),
    source: originalImage ? rgbaToDataUrl(originalImage) : svgText,
    sourceMode: originalImage ? 'image' : 'svg',
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(project)], { type: 'application/json' }));
  a.download = 'magnet-project.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

async function loadProject(file: File) {
  try {
    const project = JSON.parse(await file.text());
    if (!project.settings) throw new Error('bad project');
    const loaded = enforceFit({
      ...DEFAULT_SETTINGS,
      ...project.settings,
      palette: project.settings.palette ?? [],
      magnets: project.settings.magnets ?? [],
    });
    store.set({ settings: loaded });
    if (project.sourceMode === 'svg' && typeof project.source === 'string') {
      svgText = project.source;
      originalImage = null;
    } else if (typeof project.source === 'string') {
      originalImage = await dataUrlToImage(project.source);
      svgText = null;
    }
    rebuildSections();
    reprocess(true);
    toast('Project loaded', { kind: 'ok' });
  } catch (err) {
    toast('Invalid project file', { kind: 'error' });
    console.error(err);
  }
}

async function dataUrlToImage(url: string): Promise<RgbaImage> {
  const img = new Image();
  img.src = url;
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = rej;
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: imageData.data };
}

// ---------------------------------------------------------------------------
// Status line
// ---------------------------------------------------------------------------
store.subscribe((state) => {
  const warn = state.warnings.length > 0;
  statusEl.textContent = state.status || (warn ? state.warnings[0] : state.hasParts ? 'Ready.' : '');
  statusEl.classList.toggle('mg-status--busy', state.building);
  statusEl.classList.toggle('mg-status--warn', !state.building && !state.status && warn);
  if (extrudeChamferEl.checked !== state.settings.extrudeChamfer) {
    extrudeChamferEl.checked = state.settings.extrudeChamfer;
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(rgb: RGB): string {
  const h = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `${h(rgb[0])}${h(rgb[1])}${h(rgb[2])}`;
}
