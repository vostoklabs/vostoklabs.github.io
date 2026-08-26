/**
 * The fridge-magnet / fidget-slider generator, wrapped so a host can mount and unmount it.
 *
 * On the web this file's body ran on import — a browser tab loads the script once and never
 * unloads it, so there was nothing to call a `mount()` from. A desktop host is the opposite:
 * it mounts this into an element it owns and unmounts it when the user opens a different
 * generator. Everything that used to be top-level now lives inside `mount()`, and everything
 * that outlives a function call — the geometry worker, the WebGL viewer, the window and
 * document listeners, the popovers parked on <body> — is handed back in the teardown.
 *
 * Skipping that teardown is not a tidiness problem. A leaked WebGL context per visit reaches
 * the browser's limit at around sixteen, and it starts dropping the OLDEST one: the bug then
 * surfaces somewhere else entirely, long after the cause.
 */

import '@vostok/ui-kit/styles.css';
import '@vostok/plates/plates.css';
import './style.css';

import {
  appShell,
  topbarLinks,
  closeAllDialogs,
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
  ICONS,
  promptDialog,
  hostAssetUrl,
  rememberFile,
  rememberBytes,
  bindExternalLinks,
  chooseFile,
  button,
  iconButton,
  collapsibleSection,
  modeBar,
  stepper,
  listRow,
  numberField,
  textField,
  sourceCards,
  sampleGrid,
  uploadCta,
} from '@vostok/ui-kit';
import { BRAND } from '@vostok/brand';
import type { RegionSet } from './types';
import { createStore } from './store/store';
import { loadFileToImage, loadUrlToImage, type RgbaImage } from './image/decode';
import { processImage } from './image/pipeline';
import { parseSvg } from './image/logo';
import { SAMPLES } from './image/sample';
import { createViewer, type Viewer, type ViewPreset } from './viewer/viewer';
import { mountPlatePicker } from '@vostok/plates';
import { buildThreeMF, downloadThreeMF } from './export/threemfExport';
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
import {
  FILAMENTS,
  MAGNET_PRESETS,
  sliderGridSpec,
  sliderMinBodySizeFor,
  effectivePocketFit,
} from './types';
import { unzipSync } from 'fflate';
import {
  FONTS,
  type FontChoice,
  FALLBACK_FONT_ID,
  getFont,
  parseFont,
  registerCustomFont,
  isFontSupported,
  fontFamilyFor,
  curatedFonts,
} from '@vostok/fonts';
import { buildTextRegionSet } from './image/text';

import type { DesktopHost } from '@vostok/ui-kit';
import { setAssetBase } from './assets';

/**
 * Builds the generator into `container` and returns its teardown.
 *
 * `host` is absent on the web, and every capability it carries has a browser fallback this
 * generator already implements — Save becomes a JSON download, Load a file picker, Export a
 * download. That is what keeps one source building for both.
 */
export function mount(container: HTMLElement, host?: DesktopHost): () => void {
  setAssetBase(host?.assetBase?.() ?? undefined);

  // Outbound links go to the user's real browser rather than to this window, which has no
  // address bar and so no way back. One delegated listener, and a no-op on the web.
  bindExternalLinks(host);

  /** Everything the teardown has to undo, in the order it was set up. */
  const cleanups: (() => void)[] = [];


  const IMG_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
  const SVG_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>';
  const TEXT_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>';
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
    /** Translation of the whole slider magnet array from the body centre, mm. Both
     *  halves share one array, so this is the only way a slider's pockets move. */
    sliderArrayOffset: { x: number; y: number };

    // ---- Text source ----
    /** The line of text, when the Text tab is the import source. */
    text: string;
    /** Font id from the shared registry. */
    textFont: string;
    /** Tracking between glyphs, as a fraction of the em. Negative squashes. */
    letterSpacing: number;
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
    sliderArrayOffset: { x: 0, y: 0 },
    text: 'Hello',
    textFont: 'luckiest-guy',
    letterSpacing: 0,
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
  /** Parsed fonts for the text source, kept so a re-trace doesn't refetch them. */
  let textSource: { font: any; fallbackFont: any } | null = null;
  /** Which source owns the design.
   *
   *  `reprocess()` switches on THIS rather than sniffing whichever of
   *  originalImage / svgText / textSource happens to be non-null. Sniffing meant
   *  every import had to remember to null the other three, and the answer also
   *  depended on the order of the if-chain — importing an image while text was
   *  still loaded silently re-laid-out the text instead. One variable decides. */
  let activeSource: ImportMode | null = null;
  let regionSet: RegionSet | null = null;
  let latestParts: MagnetPart[] = [];
  let downloads = 0;
  let refitNext = true;
  let firstBuildDone = false;
  /** Which magnet the pad and the stage drag act on. */
  let activeMagnet = 0;
  /** Assigned by magnetSection(); lets the stage panel refresh the sidebar form. */
  let redrawMagnetSection: () => void = () => {};
  /** Assigned by importSourceSection(); lets the source tabs hide the controls that
   *  only mean something for a raster/vector import. Declared up here because the
   *  shell builds that section during module init, long before its own line runs. */
  let syncRemoveBg: (mode: ImportMode | null) => void = () => {};

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
      pocketProfile: v.pocketProfile,
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
  const undoBtn = iconButton({ icon: ICONS.undo, label: 'Undo', title: 'Undo (Ctrl+Z)', onClick: () => undo() });
  const redoBtn = iconButton({ icon: ICONS.redo, label: 'Redo', title: 'Redo (Ctrl+Shift+Z)', onClick: () => redo() });

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

  const onWindowKeydown = (e: KeyboardEvent) => {
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
  };
  window.addEventListener('keydown', onWindowKeydown);
  cleanups.push(() => window.removeEventListener('keydown', onWindowKeydown));

  // ---------------------------------------------------------------------------
  // Local controls
  // ---------------------------------------------------------------------------
  /** A collapsible numbered step, matching the clicker's sidebar sections. */
  function step(n: number, title: string, body: (HTMLElement | Node)[], open = false): HTMLElement {
    return collapsibleSection({ title: `${n} · ${title}`, body, open });
  }

  // ---------------------------------------------------------------------------
  // Chrome
  // ---------------------------------------------------------------------------
  const quality = qualityCallout({
    html: `Print flat on the back face with the image up, no supports needed. Profiles and print notes are on <a href="${BRAND.urls.makerworld}" target="_blank" rel="noopener">MakerWorld</a>.`,
    storageKey: 'magnet-generator-quality-callout',
  });

  // Same shape as the clicker's footer: one export button, then Save / Load /
  // Help / theme. The licence nudge lives on the export path (modal on the first
  // download, toast after) exactly as the clicker does it — not as a sidebar line.
  const footer = sidebarFooter({
    // The host draws Save and Open itself when it owns projects; two Save buttons that
    // do different things is worse than either one alone. `Boolean(...)`, not `isDesktop()`:
    // a desktop host without the capability still needs these.
    hostOwnsProjects: Boolean(host?.registerProject),
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
          description: 'Turn any image into a fridge magnet with a flat back, glue-on or embedded magnet.',
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

  container.append(shell.root);

  // ---------------------------------------------------------------------------
  // Stage: viewer, view bar, edit-mode bar, extrude panel, status
  // ---------------------------------------------------------------------------
  const stageContainer = el('div', { className: 'mg-stage-canvas' });
  shell.stage.prepend(stageContainer);
  const viewer: Viewer = createViewer(stageContainer);

  const statusEl = el('p', { className: 'mg-status', text: 'Loading…' });
  shell.stage.append(statusEl);

  // --- Build plate picker (top-right of the stage). The chosen plate is shared
  //     across every generator. ---
  mountPlatePicker(shell.stage, viewer);

  // --- View switching (programmatic only — the visible bar is removed). ---
  const setView = (preset: ViewPreset) => {
    viewer.setView(preset);
  };

  // --- Edit mode bar (Color / Extrude / Magnet), ported from the clicker ---
  const editModeBar = modeBar<EditMode>({
    modes: [
      { value: 'color', label: 'Color', icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>' },
      { value: 'extrude', label: 'Extrude', icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>' },
      { value: 'magnet', label: 'Magnet', icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v9a6 6 0 0 0 12 0V3"/><path d="M6 8h4"/><path d="M14 8h4"/></svg>' },
    ],
    value: store.get().editMode,
    onChange: (mode) => {
      store.set({ editMode: mode, selectedRegions: [] });
      viewer.clearHighlight();
      syncEditMode();
      syncExtrudePanel();
      // The pockets are on the back — put the camera where the work is.
      if (mode === 'magnet' && s().magnetMode !== 'none') setView('back');
    },
  });
  shell.stage.append(editModeBar.root);

  // --- Magnet mode: a slim hint pinned at the top of the stage (no center panel
  //     obstructing the model — count & reset live in the left sidebar). ---
  const magnetStepper = stepper({
    onStep: (delta) => (delta === 1 ? addMagnet() : removeMagnet(activeMagnet)),
  });
  const magnetHint = el('div', { className: 'mg-magnet-hint', attrs: { hidden: '' } }, [magnetStepper.root]);
  shell.stage.append(magnetHint);

  // --- Extrude panel (floating, clicker-style) ---
  const extrudeLevelLabel = el('div', { className: 'extrude-level-label', text: 'Select a part' });
  const extrudeStepperCtl = stepper({ onStep: (delta) => extrudeStep(delta) });
  const extrudeChamferToggle = toggleSwitch({
    label: 'Chamfer raised edges',
    checked: s().extrudeChamfer,
    onChange: (on) => patch({ extrudeChamfer: on }),
  });
  const extrudePanel = el('div', { className: 'edges-panel', attrs: { hidden: '' } }, [
    el('div', { className: 'edges-title', text: 'Extrude Part' }),
    extrudeLevelLabel,
    extrudeStepperCtl.root,
    extrudeChamferToggle,
    el('div', { className: 'panel-hint', text: 'Click a color on the model to select it, then raise or lower it. Click another to add it to the selection.' }),
  ]);
  shell.stage.append(extrudePanel);

  const syncEditMode = () => {
    const m = store.get().editMode;
    editModeBar.setValue(m);
    extrudePanel.toggleAttribute('hidden', m !== 'extrude');
    magnetHint.toggleAttribute('hidden', m !== 'magnet');
    // The magnet hint and the interaction hint share the bottom-center slot.
    shell.stage.querySelector('.vl-stage__hint')?.classList.toggle('hidden', m === 'magnet');
    // Magnet mode only takes LEFT-drag away (that gesture places pockets). Pan and
    // zoom must keep working, or there is no way to reach a pocket near the edge —
    // `setOrbitEnabled(false)` used to kill the whole control, wheel included.
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
          magnetStepper.setReadout('Drag the visual helper to see if your sheet fits.');
        }
        return;
      }

      clear();
      if (interactive) {
        magnetStepper.setReadout(
          v.magnetMode === 'none'
            ? 'This design uses magnetic sheet, so there are no pockets to place.'
            : 'No magnet fits this design yet.',
        );
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
      // A slider's pockets come from one shared array, so no single pocket is ever
      // "the selected one" — the drag moves all of them together.
      active: v.productType === 'slider' ? -1 : activeMagnet,
      interactive,
    });

    if (interactive) {
      magnetStepper.setReadout(
        v.productType === 'slider'
          ? 'Drag to move the whole magnet array. Both halves share one pitch, so they move together.'
          : report.positions.length > 1
            ? `Drag a magnet to move it · #${activeMagnet + 1} of ${report.positions.length} selected`
            : 'Drag the magnet to move it, or click the shape to place it there',
      );
    }
  }
  const syncExtrudePanel = () => {
    const sel = store.get().selectedRegions;
    if (sel.length === 0) {
      extrudeLevelLabel.textContent = 'Select a part';
      extrudeStepperCtl.setEnabled(false, false);
      return;
    }
    const level = s().palette[sel[0]]?.level ?? 0;
    const h = (level * s().stepHeight).toFixed(2);
    extrudeLevelLabel.textContent =
      sel.length > 1 ? `${sel.length} colors · Level: ${level} · ${h} mm` : `Level: ${level} · ${h} mm`;
    extrudeStepperCtl.setEnabled(level > 0, level < MAX_LEVEL);
  };

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
    const row = container.querySelectorAll<HTMLElement>('.fil-row.region-row')[palIndex];
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
  /** Slider only: where the pointer grabbed the array, and the offset it started
   *  from. The whole matrix moves by the delta between them. */
  let sliderDrag: { fromX: number; fromY: number; baseX: number; baseY: number } | null = null;

  /** A left-drag in Magnet mode that grabbed nothing is almost always someone trying
   *  to spin the view. Left-drag is the placement gesture here, so orbit is off — say
   *  so once per attempt rather than leaving the stage feeling frozen. */
  let orbitAttempt: { x: number; y: number } | null = null;
  let lastOrbitToast = 0;

  stageContainer.addEventListener('pointerdown', (e) => {
    if (store.get().editMode !== 'magnet' || e.button !== 0) return;
    const report = store.get().report;
    const v = store.get().settings;
    const isHelper = v.magnetMode === 'none' && v.sheetHelperEnabled;
    if (!isHelper && (!report || report.positions.length === 0)) return;
    const grabbed = viewer.handleAt(e.clientX, e.clientY);
    const point = viewer.pickBodyPoint(e.clientX, e.clientY);
    if (grabbed === null && !point) orbitAttempt = { x: e.clientX, y: e.clientY };

    // A slider's two halves have to stay on one shared pitch — that pitch IS the
    // click. So a grab anywhere on the array drags the ENTIRE matrix, both halves
    // together, rather than pulling one pocket (and its twin) out of formation.
    if (v.productType === 'slider') {
      if (grabbed === null && !point) return;
      const anchor = point ?? viewer.pickBodyPoint(e.clientX, e.clientY);
      if (!anchor) return;
      const base = v.sliderArrayOffset ?? { x: 0, y: 0 };
      sliderDrag = { fromX: anchor[0], fromY: anchor[1], baseX: base.x, baseY: base.y };
      stageContainer.setPointerCapture(e.pointerId);
      stageContainer.classList.add('mg-dragging');
      return;
    }

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
    if (orbitAttempt) {
      // Only a real drag counts — a plain click on the background is not an orbit.
      if (Math.hypot(e.clientX - orbitAttempt.x, e.clientY - orbitAttempt.y) > 6) {
        orbitAttempt = null;
        if (Date.now() - lastOrbitToast > 6000) {
          lastOrbitToast = Date.now();
          toast(
            'Orbit is off in Magnet mode. Left-drag places pockets. Right-drag to pan, scroll to zoom, ' +
              'or switch to Color or Extrude mode to rotate.',
            { kind: 'info' },
          );
        }
      }
    }
    if (sliderDrag) {
      const point = viewer.pickBodyPoint(e.clientX, e.clientY);
      if (!point) return;
      patch({
        sliderArrayOffset: {
          x: round1(sliderDrag.baseX + (point[0] - sliderDrag.fromX)),
          y: round1(sliderDrag.baseY + (point[1] - sliderDrag.fromY)),
        },
      });
      return;
    }
    if (draggingMagnet === null) return;
    const point = viewer.pickBodyPoint(e.clientX, e.clientY);
    if (point) moveMagnetTo(draggingMagnet, point[0], point[1]);
  });

  const endMagnetDrag = (e: PointerEvent) => {
    orbitAttempt = null;
    if (sliderDrag) {
      sliderDrag = null;
      stageContainer.classList.remove('mg-dragging');
      if (stageContainer.hasPointerCapture(e.pointerId)) stageContainer.releasePointerCapture(e.pointerId);
      // The builder clamps the offset at the body wall; adopt what it actually used
      // so a drag past the edge stops there instead of banking up dead offset.
      const applied = store.get().report?.sliderArrayOffset;
      if (applied) patch({ sliderArrayOffset: { x: round1(applied.x), y: round1(applied.y) } });
      return;
    }
    if (draggingMagnet === null) return;
    draggingMagnet = null;
    stageContainer.classList.remove('mg-dragging');
    if (stageContainer.hasPointerCapture(e.pointerId)) stageContainer.releasePointerCapture(e.pointerId);
    redrawMagnetSection(); // manual placement may have just turned on
  };
  stageContainer.addEventListener('pointerup', endMagnetDrag);
  stageContainer.addEventListener('pointercancel', endMagnetDrag);

  // Watches <html>, which outlives this generator — so it has to be disconnected, or every
  // theme flip after unmount would still be calling into a disposed viewer.
  const themeObserver = new MutationObserver(() => {
    viewer.setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  cleanups.push(() => themeObserver.disconnect());
  cleanups.push(() => viewer.dispose());

  // ---------------------------------------------------------------------------
  // Geometry worker
  // ---------------------------------------------------------------------------
  const worker = new Worker(new URL('./workers/geometry.worker.ts', import.meta.url), { type: 'module' });
  cleanups.push(() => worker.terminate());

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
      activeSource = 'image';
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
            textSource = null;
            activeSource = 'image';
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
        toast(`Could not read that image: ${why}`, { kind: 'error' });
        console.error(err);
      });
  }

  async function importSvgFile(file: File) {
    try {
      svgText = await file.text();
      originalImage = null;
      baseImage = null;
      textSource = null;
      activeSource = 'svg';
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
      if (activeSource === 'text' && textSource) {
        store.set({ building: true, status: 'Laying out text…' });
        regionSet = buildTextRegionSet({
          text: v.text,
          font: textSource.font,
          fallbackFont: textSource.fallbackFont,
          letterSpacing: v.letterSpacing,
        });
      } else if (activeSource === 'image' && originalImage) {
        store.set({ building: true, status: 'Tracing image…' });
        regionSet = processImage(cloneImage(originalImage), v.colorCount, { removeBg: v.removeBg, smoothing: v.smoothing });
      } else if (activeSource === 'svg' && svgText) {
        store.set({ building: true, status: 'Parsing SVG…' });
        regionSet = parseSvg(svgText, { removeBg: v.removeBg });
      } else {
        store.set({ status: 'Import an image, SVG or text first.' });
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
      sliderArrayOffset: v.sliderArrayOffset,
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
    if (formatId !== '3mf') throw new Error('Unknown format: ' + formatId);

    if (host) {
      // The whole reason the desktop bundle exists: the file does not land in Downloads for
      // you to go and find, it lands in the library and shows up in the grid.
      const { indexed } = await host.exportToLibrary(
        { name: `${stem}.3mf`, bytes: buildThreeMF(latestParts) },
        { designer: 'Fridge Magnet Generator' },
      );
      toast(indexed ? 'Exported to your library' : `Exported as ${stem}.3mf`, { kind: 'ok' });
      return;
    }

    downloadThreeMF(latestParts, `${stem}.3mf`);

    // Licence nudges are a web-only thing; the ui-kit no-ops them on the desktop, where the
    // licence is whatever tier the user bought the app under.
    downloads += 1;
    if (downloads === 1) openLicenseModal();
    else licenseReminderToast();
  }

  // ---------------------------------------------------------------------------
  // Text source
  // ---------------------------------------------------------------------------
  type ImportMode = 'image' | 'svg' | 'text';

  /** Make text the design's source (or re-trace it after an edit). Loads the font
   *  once and keeps it, so typing doesn't refetch a .ttf on every keystroke. */
  async function applyTextSource(takeOver = false) {
    const v = s();
    if (!v.text.trim()) {
      store.set({ status: 'Type something to put on the magnet.' });
      return;
    }
    try {
      const [font, fallbackFont] = await Promise.all([
        getFont(v.textFont),
        getFont(FALLBACK_FONT_ID).catch(() => null),
      ]);
      textSource = { font, fallbackFont };
      // The image/SVG are deliberately kept in memory: `activeSource` decides who
      // owns the design, so switching back to that tab restores it instead of
      // leaving the user with an empty panel and a lost import.
      activeSource = 'text';
      store.set({ settings: { ...s(), sourceName: v.text } });
      reprocess(takeOver);
    } catch (err) {
      store.set({ building: false, status: '' });
      toast(`Could not load that font: ${err instanceof Error ? err.message : String(err)}`, { kind: 'error' });
      console.error(err);
    }
  }

  const debouncedTextRebuild = debounce(() => void applyTextSource(), 220);

  /** Searchable, category-filtered font picker with a live preview of the user's
   *  own text. Ported from the keychain; the registry it reads is shared. */
  function openFontBrowser(currentId: string, sampleText: string, onPick: (id: string) => void) {
    const categories = ['All', ...Array.from(new Set(FONTS.map((f) => f.category))).sort()];
    let cat = 'All';
    let search = '';

    const list = el('div', { className: 'mg-fb__list' });
    const searchField = textField({
      label: 'Search',
      type: 'search',
      placeholder: `Search ${FONTS.length} fonts…`,
      onInput: (v) => {
        search = v;
        render();
      },
    });
    const catRow = segmentedControl<string>({
      options: categories.map((c) => ({ value: c, label: c })),
      value: cat,
      onChange: (c) => {
        cat = c;
        render();
      },
    });

    const render = () => {
      const q = search.trim().toLowerCase();
      const matches = FONTS.filter(
        (f) =>
          (cat === 'All' || f.category === cat) &&
          (!q || f.label.toLowerCase().includes(q) || f.category.toLowerCase().includes(q)),
      );
      list.replaceChildren(
        ...matches.map((f) => {
          const row = el('button', {
            className: `mg-fb__row${f.id === currentId ? ' active' : ''}`,
            attrs: { type: 'button', 'data-font': f.id },
          }, [
            el('span', {
              className: 'mg-fb__preview',
              text: sampleText.slice(0, 12) || f.label,
              attrs: { style: `font-family: ${fontFamilyFor(f.id)}` },
            }),
            el('span', { className: 'mg-fb__meta' }, [
              el('span', { className: 'mg-fb__name', text: f.label }),
              el('span', { className: 'mg-fb__cat', text: f.category }),
            ]),
          ]);
          row.addEventListener('click', () => {
            onPick(f.id);
            modal.close();
          });
          return row;
        }),
      );
      if (matches.length === 0) {
        list.append(el('p', { className: 'vl-hint', text: 'No fonts match that search.' }));
      }
    };

    render();

    const modal = dialog({
      title: 'Browse fonts',
      content: el('div', { className: 'mg-fb' }, [searchField, catRow, list]),
      actions: [{ label: 'Close' }],
    });
  }

  /** Import a .ttf/.otf, or a .zip of them, and select the last one loaded. */
  async function importCustomFont(file: File, onLoaded: (id: string) => void) {
    try {
      const raw = await file.arrayBuffer();
      const items: { name: string; buffer: ArrayBuffer }[] = [];
      if (file.name.toLowerCase().endsWith('.zip')) {
        const unzipped = unzipSync(new Uint8Array(raw));
        for (const [name, data] of Object.entries(unzipped)) {
          const lower = name.toLowerCase();
          if (name.endsWith('/') || !(lower.endsWith('.ttf') || lower.endsWith('.otf'))) continue;
          items.push({
            name: name.split('/').pop() || name,
            buffer: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
          });
        }
        if (items.length === 0) {
          toast('No .ttf or .otf files found in that zip.', { kind: 'error' });
          return;
        }
      } else {
        items.push({ name: file.name, buffer: raw });
      }

      let last = '';
      let n = 0;
      for (const item of items) {
        try {
          const parsed = parseFont(item.buffer);
          const id = `custom-${Date.now()}-${n++}`;
          registerCustomFont(id, parsed);
          // The face is usable either way; this is what stops it being usable only until
          // the tab closes. Per-face rather than per-zip, so a twelve-weight family shows
          // up as twelve things the user can reach for again.
          void rememberBytes(host, 'font', item.name, item.buffer);
          // Give the HTML preview the same face the geometry will use.
          const style = document.createElement('style');
          style.textContent = `@font-face { font-family: '${fontFamilyFor(id)}'; src: url('${URL.createObjectURL(new Blob([item.buffer]))}'); }`;
          document.head.appendChild(style);
          FONTS.unshift({
            id,
            label: item.name.replace(/\.[^/.]+$/, ''),
            category: 'Custom',
            curated: true,
            subsets: ['latin', 'latin-ext', 'cyrillic', 'greek'],
          });
          last = id;
        } catch (err) {
          console.error(`Failed to load font ${item.name}:`, err);
        }
      }
      if (!last) {
        toast('Could not read that font file.', { kind: 'error' });
        return;
      }
      toast(items.length > 1 ? `Imported ${items.length} fonts` : 'Font imported', { kind: 'ok' });
      onLoaded(last);
    } catch (err) {
      toast('Could not read that font file.', { kind: 'error' });
      console.error(err);
    }
  }

  // ---------------------------------------------------------------------------
  // Right panel — Import Source
  // ---------------------------------------------------------------------------
  function importSourceSection(): HTMLElement {
    const sec = el('div', { className: 'vl-section' });
    sec.innerHTML = `
      <p class="vl-label">Import Source</p>
      <div id="mgImportTabs"></div>
      <div id="imagePanel" class="mode-panel">
        <div class="drop" id="mgDrop">
          <span class="drop-icon">${UPLOAD_ICON}</span>
          <div class="drop-title">Upload image</div>
          <div class="drop-text">Drop an image, or <u>click to browse</u></div>
          <span class="drop-note">PNG with transparency works best</span>
        </div>
        <input type="file" id="mgFile" accept="image/png,image/jpeg,image/webp" hidden />
        <div id="mgSampleGrid"></div>
      </div>
      <div id="svgPanel" class="mode-panel" hidden>
        <p class="hint-text">Drop or upload SVG vector files. Color paths map to colors.</p>
        <div id="mgSvgUploadMount"></div>
      </div>
      <div id="textPanel" class="mode-panel" hidden>
        <p class="hint-text">Type a word and pick a font. Base shape "Image outline" hugs the letters; the preset shapes put them on a plate.</p>
        <div id="mgTextInputMount"></div>
        <div id="mgFontGrid" class="mg-font-grid"></div>
        <div id="mgBrowseFontsMount"></div>
        <div id="mgFontUploadMount"></div>
        <div id="mgTextTuning"></div>
      </div>
    `;

    const $ = <T extends HTMLElement>(sel: string) => sec.querySelector<T>(sel)!;
    const tabsMount = $('#mgImportTabs');
    const imagePanel = $('#imagePanel');
    const svgPanel = $('#svgPanel');
    const drop = $('#mgDrop');
    const file = $<HTMLInputElement>('#mgFile');

    const textPanel = $('#textPanel');

    const setMode = (mode: ImportMode) => {
      importCards.setValue(mode);
      imagePanel.hidden = mode !== 'image';
      svgPanel.hidden = mode !== 'svg';
      textPanel.hidden = mode !== 'text';
      syncRemoveBg(mode);
    };
    const importCards = sourceCards<ImportMode>({
      options: [
        { value: 'image', label: 'Image', icon: IMG_ICON },
        { value: 'svg', label: 'SVG', icon: SVG_ICON },
        { value: 'text', label: 'Text', icon: TEXT_ICON },
      ],
      value: 'image',
      onChange: (mode) => {
        setMode(mode);
        if (mode === activeSource) return;
        // Picking a tab switches the design back to that source when it still has
        // one loaded. Nothing is discarded on the way out, so this round-trips.
        if (mode === 'text') {
          void applyTextSource(true);
        } else if (mode === 'image' && originalImage) {
          activeSource = 'image';
          reprocess(true);
        } else if (mode === 'svg' && svgText) {
          activeSource = 'svg';
          reprocess(true);
        }
        // No source of that kind yet — the panel is showing so the user can add one.
      },
    });
    tabsMount.append(importCards.root);

    // With a host this opens its media library — every image imported into any generator,
    // and a way to the file system beyond it. Without one it clicks the hidden input, which
    // answers through its own `change` handler below. The generator never learns which.
    drop.addEventListener('click', () => {
      void chooseFile(host, { kind: 'image', extensions: ['png', 'jpg', 'jpeg', 'webp'] }, () => file.click())
        .then((f) => {
          if (!f) return;
          void rememberFile(host, 'image', f);
          openImport(f.name, () => loadFileToImage(f));
        });
    });
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      if (f) {
        // Kept the moment it arrives, not when a project is saved. Save is a thing the
        // user can forget; importing is a thing they just did — and keeping it here is
        // what makes the *next* magnet, and the clicker, free. No-op without a host.
        void rememberFile(host, 'image', f);
        openImport(f.name, () => loadFileToImage(f));
      }
      file.value = ''; // re-picking the same file must still fire
    });
    const svgUpload = uploadCta({
      label: 'Upload SVG file(s)',
      icon: UPLOAD_ICON,
      accept: '.svg,image/svg+xml',
      multiple: true,
      onFiles: (files) => {
        for (const f of files) {
          void rememberFile(host, 'svg', f);
          void importSvgFile(f);
        }
      },
    });
    // The label wraps the input, so the host's library has to pre-empt the click rather
    // than replace it — otherwise both open.
    svgUpload.addEventListener('click', (e) => {
      if (!host?.pickMedia) return;
      e.preventDefault();
      void chooseFile(host, { kind: 'svg', extensions: ['svg'] }, () => {}).then((f) => {
        if (f) void importSvgFile(f);
      });
    });
    $('#mgSvgUploadMount').replaceWith(svgUpload);

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
    // On `window`, not the drop zone: dropping a file anywhere else in the app would
    // otherwise navigate the whole webview to it. Both come off again on unmount.
    const onWindowDragover = (e: DragEvent) => e.preventDefault();
    const onWindowDrop = (e: DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      if (f.name.toLowerCase().endsWith('.svg')) {
        setMode('svg');
        void rememberFile(host, 'svg', f);
        void importSvgFile(f);
      } else if (f.type.startsWith('image/')) {
        setMode('image');
        void rememberFile(host, 'image', f);
        openImport(f.name, () => loadFileToImage(f));
      }
    };
    window.addEventListener('dragover', onWindowDragover);
    window.addEventListener('drop', onWindowDrop);
    cleanups.push(() => {
      window.removeEventListener('dragover', onWindowDragover);
      window.removeEventListener('drop', onWindowDrop);
    });

    $('#mgSampleGrid').replaceWith(sampleGrid({
      heading: 'Choose a sample image',
      items: SAMPLES.map((sample) => ({ src: sample.src, label: sample.name })),
      onPick: (_item, i) => openImport(SAMPLES[i].name, SAMPLES[i].load),
    }));

    // ---- Text source ----
    const fontGrid = $('#mgFontGrid');

    const fontCard = (font: FontChoice): HTMLButtonElement => {
      const supported = isFontSupported(font, s().text);
      const btn = el('button', {
        className: `mg-font-card${font.id === s().textFont ? ' active' : ''}${supported ? '' : ' unsupported'}`,
        attrs: {
          type: 'button',
          'data-font': font.id,
          title: supported ? font.label : `${font.label} (characters missing)`,
        },
      }, [
        el('span', {
          className: 'mg-font-card__sample',
          text: s().text.slice(0, 6) || 'Abc',
          attrs: { style: `font-family: ${fontFamilyFor(font.id)}` },
        }),
        el('span', { className: 'mg-font-card__name', text: font.label }),
      ]) as HTMLButtonElement;
      btn.addEventListener('click', () => {
        patchImage({ textFont: font.id });
        renderFontGrid();
        void applyTextSource();
      });
      return btn;
    };

    // The active font is pinned first when it isn't curated, so a pick made in the
    // browse-all modal stays visible in the grid.
    const renderFontGrid = () => {
      fontGrid.replaceChildren();
      const active = FONTS.find((f) => f.id === s().textFont);
      if (active && !active.curated) fontGrid.append(fontCard(active));
      for (const f of curatedFonts()) fontGrid.append(fontCard(f));
    };
    renderFontGrid();

    const textInputField = textField({
      label: 'Text',
      value: s().text,
      onInput: (v) => {
        patchImage({ text: v });
        renderFontGrid(); // samples and the "characters missing" flag follow the text
        debouncedTextRebuild();
      },
    });
    textInputField.field.maxLength = 24;
    $('#mgTextInputMount').replaceWith(textInputField);

    const browseBtn = button({
      label: `Browse all ${FONTS.length} fonts →`,
      emphasis: 'secondary',
      block: true,
      onClick: () => {
        openFontBrowser(s().textFont, s().text, (id) => {
          patchImage({ textFont: id });
          renderFontGrid();
          void applyTextSource();
        });
      },
    });
    $('#mgBrowseFontsMount').replaceWith(browseBtn);

    const fontUploadCta = uploadCta({
      label: 'Import custom font (.ttf/.otf/.zip)',
      icon: UPLOAD_ICON,
      accept: '.ttf,.otf,.zip',
      onFiles: (files) => {
        const f = files[0];
        if (f) void importCustomFont(f, (id) => {
          patchImage({ textFont: id });
          renderFontGrid();
          void applyTextSource();
        });
      },
    });
    fontUploadCta.classList.add('mg-font-import');
    fontUploadCta.addEventListener('click', (e) => {
      if (!host?.pickMedia) return;
      e.preventDefault();
      void chooseFile(host, { kind: 'font', extensions: ['ttf', 'otf', 'zip'] }, () => {}).then((f) => {
        if (f) void importCustomFont(f, (id) => {
          patchImage({ textFont: id });
          renderFontGrid();
          void applyTextSource();
        });
      });
    });
    $('#mgFontUploadMount').replaceWith(fontUploadCta);

    // Letter spacing now lives in the left panel's Shape & size step, next to the
    // other geometry controls.

    // Background removal sits with the import, same as the clicker. Re-tuning the
    // image is done by re-importing it — the wizard opens on every import, so a
    // separate "adjust" button is one control too many.
    //
    // Text is rendered as glyphs on nothing, so there is no background to drop —
    // the toggle is meaningless in that mode and hides with it.
    const removeBgRow = toggleSwitch({
      label: 'Remove background',
      checked: s().removeBg,
      help: 'Drops a flat background so only the subject is traced. Turn off if your image is already cut out.',
      onChange: (on) => {
        patchImage({ removeBg: on });
        debouncedReprocess();
      },
    });
    sec.append(removeBgRow);
    syncRemoveBg = (mode: ImportMode | null) => removeBgRow.toggleAttribute('hidden', mode === 'text');
    syncRemoveBg(activeSource);

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
    // Letter spacing is a shape control, not an import control — it belongs here in
    // the left settings panel with Size and Margin, not buried in the right-hand
    // Import Source card. Only text designs have letters, so it hides otherwise.
    const letterSpacingRow = sliderRow({
      label: 'Letter spacing',
      min: -0.15,
      max: 0.4,
      step: 0.01,
      value: s().letterSpacing,
      unit: 'em',
      help: 'Tracking between letters, as a fraction of the font size. Negative pulls them together, useful when you want the letters to touch so the magnet prints as one piece.',
      onInput: (val) => {
        patchImage({ letterSpacing: val });
        debouncedTextRebuild();
      },
    });
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
      help: 'Body height. Never goes below what the magnet needs. The slider snaps back if you try.',
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

      letterSpacingRow.toggleAttribute('hidden', activeSource !== 'text');
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
      letterSpacingRow,
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
        const reset = button({
          label: `Reset ${overrides} recoloured shape${overrides === 1 ? '' : 's'}`,
          emphasis: 'ghost',
          block: true,
          title: 'Put every individually recoloured shape back on its palette row',
          onClick: () => patch({ componentColors: {} }),
        });
        pal.append(reset);
      }
      const slots = filamentSlotCount();
      if (slots > 4) {
        pal.append(
          el('p', {
            className: 'mg-warn',
            text: `This model uses ${slots} colours, more than a 4-slot AMS. Reuse a colour you already have, or the slicer will ask you to swap filament mid-print.`,
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
      // baseShape is in here because it decides whether the slider's second piece
      // is mirrored, and the assembly copy has to say which one you're getting.
      // pocketProfile likewise changes the fit slider's help text.
      const sig = [v.productType, v.magnetMode, v.magnetShape, v.magnetCount, v.magnetPlacement, v.sliderLayout, v.sliderMirrorBlank, v.baseShape, v.pocketProfile].join('|');
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

      const setupBtn = button({
        label: 'Not sure? Walk me through it',
        emphasis: 'ghost',
        block: true,
        onClick: () => void runWizard(),
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
            onInput: (val) => { patch({ magnetX: val }); syncMagnetHandles(); },
          }),
          numberField({
            label: 'Length', value: v.magnetY, min: 3, max: 200, step: 0.5, unit: 'mm',
            onInput: (val) => { patch({ magnetY: val }); syncMagnetHandles(); },
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
              onInput: (val) => patch({ magnetDiameter: val }),
            }),
            numberField({
              label: 'Height', value: v.magnetDepth, min: 0.5, max: 6, step: 0.5, unit: 'mm',
              onInput: (val) => patch({ magnetDepth: val }),
            }),
          ]
        : [
            numberField({
              label: 'Width', value: v.magnetX, min: 3, max: 60, step: 0.5, unit: 'mm',
              onInput: (val) => patch({ magnetX: val }),
            }),
            numberField({
              label: 'Length', value: v.magnetY, min: 3, max: 60, step: 0.5, unit: 'mm',
              onInput: (val) => patch({ magnetY: val }),
            }),
            numberField({
              label: 'Height', value: v.magnetDepth, min: 0.5, max: 6, step: 0.5, unit: 'mm',
              onInput: (val) => patch({ magnetDepth: val }),
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
          button({
            label: 'Reset to automatic placement',
            emphasis: 'secondary',
            block: true,
            onClick: () => {
              activeMagnet = 0;
              patch({ magnetPlacement: 'auto', magnets: [] });
              redrawForm();
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
              { value: 'round', label: 'Round, matches the magnet' },
              { value: 'hex', label: 'Hex, easier to print, grips better' },
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
          help: v.pocketProfile === 'hex' && v.magnetShape === 'disc'
            ? "Added to the magnet's diameter, not its radius. Hex walls print true, so the first 0.2 mm is dropped. A round hole needs it to cancel shrinkage, a hex one doesn't, and keeping it just makes the socket loose. Raise this if your magnets won't go in."
            : `Added to the magnet's ${v.magnetShape === 'disc' ? 'diameter' : 'width and length'}, not its radius. A ⌀6 magnet with 0.2 mm gets a ⌀6.2 socket. Raise it if your magnets won't go in, drop it toward 0 for a tighter grip.`,
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
      const tuningDetails = collapsibleSection({ title: 'Fine tuning', body: tuning, open: false });

      // --- Slider-specific controls ---
      const isSlider = v.productType === 'slider';
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
        help: 'Plastic between the pockets, on top of the 2 mm minimum. Wider spacing means a longer throw between clicks, and a bigger body.',
        onInput: (val) => {
          patch({ sliderGap: val });
          syncReport();
        },
      }) : null;

      const sliderBlankToggle = isSlider ? toggleSwitch({
        label: 'Blank second piece',
        checked: v.sliderMirrorBlank,
        help: 'When on, the second half is a plain slab with magnet pockets: no image, no colour changes.',
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
          ? 'Sealed under a thin wall. No glue, but that wall sits between the magnets and softens the click.'
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
      const sliderPolarity = isSlider ? collapsibleSection({
        title: 'How to insert the magnets',
        open: false,
        body: [
          el('p', {
            className: 'vl-hint',
            text: v.baseShape === 'outline'
              ? 'The second piece is built as a mirror of the first. Flipping a piece over mirrors its outline, so a mirrored twin is what makes the two silhouettes stack flush. The trade-off is that any lettering on the underside reads reversed. Switch Base shape to a preset if you want both faces to read the same way.'
              : 'Both halves are the same print. The plate is symmetric, so flipping one over lands it exactly on the other and the artwork still reads the right way round on both faces.',
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
        ],
      }) : null;

      // Real fidget sliders are built around small discs; a ⌀12 magnet makes a
      // brick that snaps shut instead of sliding.
      const sliderMagnetWarn =
        isSlider && v.magnetShape === 'disc' && v.magnetDiameter > 8
          ? el('p', {
              className: 'mg-warn',
              text: `⌀${v.magnetDiameter} mm is very strong for a slider. It will clamp rather than glide. ⌀5–8 mm is the usual range.`,
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
            : 'Flat back, no pocket. Stick the print onto adhesive magnetic sheet.';
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
        const fit = effectivePocketFit(v.pocketFit, v.pocketProfile);
        rows.push(
          reportRow(
            'Socket',
            v.magnetShape !== 'disc'
              ? `${(v.magnetX + fit).toFixed(1)} × ${(v.magnetY + fit).toFixed(1)} mm for a ${v.magnetX} × ${v.magnetY} mm magnet`
              : v.pocketProfile === 'hex'
                // Both numbers matter for a hex: the flats are what grip the
                // magnet, the corners are what the socket looks like.
                ? `${(v.magnetDiameter + fit).toFixed(2)} mm across flats · ${((v.magnetDiameter + fit) / Math.cos(Math.PI / 6)).toFixed(2)} across corners`
                : `⌀${(v.magnetDiameter + fit).toFixed(2)} mm for a ⌀${v.magnetDiameter} mm magnet`,
          ),
        );
        rows.push(reportRow('Over the magnet', `${cover.toFixed(1)} mm of body`));
        if (v.magnetMode === 'embedded') {
          const back = clamp(v.backWall, BACK_WALL_MIN, BACK_WALL_MAX);
          const pauseZ = back + (report?.pocketDepth ?? v.magnetDepth);
          const layer = Math.round(pauseZ / 0.2);
          rows.push(reportRow('Pause at', `${pauseZ.toFixed(2)} mm, layer ${layer}`));
          fitReport.replaceChildren(
            ...rows,
            el('p', {
              className: 'vl-hint',
              text: v.productType === 'slider'
                ? `Add a pause at layer ${layer} in each piece, drop the magnets in (alternating polarity up each column) and resume. They end up sealed under ${back.toFixed(1)} mm on the sliding face.`
                : `Add a pause at layer ${layer} in your slicer, drop the magnet in, and resume. It ends up sealed under ${cover.toFixed(1)} mm of body with ${back.toFixed(1)} mm against the fridge.`,
            }),
          );
        } else {
          fitReport.replaceChildren(
            ...rows,
            el('p', {
              className: 'vl-hint',
              text: v.productType === 'slider'
                ? 'The pockets open on the back, which is the sliding face. Glue each magnet in flush, alternating polarity up each column.'
                : 'The pocket opens at the back, so no pause needed. Glue the magnet in after printing.',
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
    const existing = shell.leftScroll.querySelectorAll('.vl-section.vl-section--collapsible');
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
        el('p', { text: 'Step 3 sets up the magnet. Glue-on cuts a pocket that opens at the back: print it, drop the magnet in, glue it. Embedded seals the magnet inside: your slicer pauses once at the layer we show you, you drop the magnet in, and the print closes over it. Magnetic sheet leaves the back flat with no pocket at all.' }),
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
    // On <body> so the panel's overflow never clips it — which also puts it outside the
    // container, where the teardown's replaceChildren() would never reach it.
    document.body.appendChild(popover);

    let done = false;
    const close = () => {
      if (done) return;
      done = true;
      popover.remove();
      document.removeEventListener('mousedown', dismiss);
    };
    // Unmounting with a popover still open would otherwise strand it on <body>, together
    // with the document-level listener that dismisses it.
    cleanups.push(close);
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

  /** The project currently open, so Save overwrites it instead of piling up copies. */
  let currentProjectId: string | undefined;

  /**
   * The saved shape, identical on both backends.
   *
   * The source image rides inside it as a data URL rather than as a path — which means a
   * host-stored project carries its own artwork and cannot be broken by the user tidying up
   * the folder they originally imported from. That is the same "copy, never reference" rule
   * the rest of Opal's storage follows; here the format already had it.
   */
  function buildProject() {
    // Text needs no payload — the line, the font id and the tracking all live in
    // settings, and the font itself comes from the bundled set on load.
    const mode: ImportMode = activeSource ?? 'image';
    return {
      v: 2,
      settings: s(),
      source: mode === 'text' ? null : originalImage ? rgbaToDataUrl(originalImage) : svgText,
      sourceMode: mode,
    };
  }

  /** The preview the Open list shows. A save is still worth doing without one. */
  function capturePreview(): string | undefined {
    const canvas = stageContainer.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return undefined;
    try {
      return canvas.toDataURL('image/png');
    } catch {
      return undefined;
    }
  }

  async function saveToHost() {
    if (!host) return;
    const suggested = s().productType === 'slider' ? 'Slider' : 'Magnet';
    const name = await promptDialog({
      title: currentProjectId ? 'Rename and save' : 'Save project',
      label: 'Project name',
      value: suggested,
    });
    if (name === null) return;
    try {
      const saved = await host.saveProject({
        id: currentProjectId,
        name: name.trim() || suggested,
        params: buildProject(),
        previewDataUrl: capturePreview(),
      });
      currentProjectId = saved.id;
      toast(`Saved "${saved.name}"`, { kind: 'ok' });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save the project', { kind: 'error' });
    }
  }

  async function openFromHost() {
    if (!host) return;
    let projects: Awaited<ReturnType<DesktopHost['listProjects']>>;
    try {
      projects = await host.listProjects();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not read your projects', { kind: 'error' });
      return;
    }
    if (!projects.length) {
      toast('No saved projects yet', { kind: 'warn' });
      return;
    }

    const list = el('div', { className: 'mg-project-list' });
    const handle = dialog({ title: 'Open a project', content: list });

    for (const p of projects) {
      // The host turns a path into a URL, because the right protocol is `asset:` on
      // macOS and Linux and `http://asset.localhost` on Windows — a hand-written one is
      // a broken thumbnail on one of the two, with nothing in the console to say why.
      const row = listRow({
        label: p.name,
        thumb: p.preview ? hostAssetUrl(host, p.preview) : undefined,
        onClick: () => {
          handle.close();
          void openProject(p.id);
        },
      });
      list.append(row);
    }
  }

  /**
   * Loads one saved project into the live UI.
   *
   * Shared by the Open list and by the host handing us a project on arrival — the user
   * clicked a saved magnet in the app's picker rather than the generator's own tile, and
   * making them find it again in a dialog would be a strange way to honour that click.
   */
  async function openProject(projectId: string) {
    if (!host) return;
    try {
      const project = await host.loadProject(projectId);
      await applyProject(project.params);
      currentProjectId = project.id;
      toast(`Opened "${project.name}"`, { kind: 'ok' });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not open the project', { kind: 'error' });
    }
  }

  /**
   * Hand the host the three things it needs to own projects for this generator.
   *
   * Autosave, the unsaved dot, Save, Open, Rename, Delete and Start fresh then belong to
   * the host, drawn once in its own chrome for every generator it hosts, rather than a
   * fourth copy of that machinery living in here. Absent on the web, where every path
   * below keeps working exactly as it did.
   */
  host?.registerProject?.({
    getState: () => buildProject(),
    applyState: (loaded) => applyProject(loaded),
    capturePreview,
    suggestName: () => (s().productType === 'slider' ? 'Slider' : 'Magnet'),
  });

  // Only when the host is *not* owning projects: with `registerProject` it opens the
  // arriving project itself, and doing it here too would open it twice.
  if (!host?.registerProject) {
    const arrivingWith = host?.initialProjectId?.();
    if (arrivingWith) void openProject(arrivingWith);
  }

  function saveProject() {
    if (host) { void saveToHost(); return; }
    const project = buildProject();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(project)], { type: 'application/json' }));
    a.download = 'magnet-project.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function loadProject(file?: File) {
    // On the desktop the kit's Load button hands us nothing and expects the host's own
    // picker to be opened instead — there is no file input in that story.
    if (host) { void openFromHost(); return; }
    if (!file) return;
    try {
      await applyProject(JSON.parse(await file.text()));
    } catch {
      toast('Could not load that project file', { kind: 'error' });
    }
  }

  /** Applies a parameter blob to the live UI. Shared by both load paths. */
  async function applyProject(raw: unknown) {
    const project = raw as {
      settings?: Partial<Settings>;
      source?: unknown;
      sourceMode?: string;
    };
    if (!project?.settings) throw new Error('bad project');
    {
      const loaded = enforceFit({
        ...DEFAULT_SETTINGS,
        ...project.settings,
        palette: project.settings.palette ?? [],
        magnets: project.settings.magnets ?? [],
      });
      store.set({ settings: loaded });
      if (project.sourceMode === 'text') {
        // A custom-imported font is gone once the tab closes; applyTextSource
        // reports that rather than silently rendering the wrong face.
        rebuildSections();
        await applyTextSource(true);
        toast('Project loaded', { kind: 'ok' });
        return;
      }
      textSource = null;
      if (project.sourceMode === 'svg' && typeof project.source === 'string') {
        svgText = project.source;
        originalImage = null;
        activeSource = 'svg';
      } else if (typeof project.source === 'string') {
        originalImage = await dataUrlToImage(project.source);
        svgText = null;
        activeSource = 'image';
      }
      rebuildSections();
      reprocess(true);
      toast('Project loaded', { kind: 'ok' });
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
    extrudeChamferToggle.setValue(state.settings.extrudeChamfer);
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


  return () => {
    // Dialogs live on <body>, outside the container the host clears. The magnet wizard's
    // steps carry their own WebGL preview, so a stranded one holds a context for good.
    closeAllDialogs();
    for (const fn of cleanups.reverse()) {
      try { fn(); } catch { /* one failed cleanup must not strand the rest */ }
    }
    cleanups.length = 0;
    container.replaceChildren();
  };
}
