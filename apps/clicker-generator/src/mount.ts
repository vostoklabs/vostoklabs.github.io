/**
 * The clicker generator, wrapped so a host can mount and unmount it.
 *
 * On the web this file's body ran on import — a browser tab loads the script once and never
 * unloads it, so there was nothing to call a `mount()` from. A desktop host is the opposite:
 * it mounts this into an element it owns and unmounts it when the user opens a different
 * generator. Everything that used to be top-level now lives inside `mount()`, and everything
 * that outlives a function call — the geometry worker, the WebGL viewer, the window and
 * document listeners, the modals and popovers parked on <body> — is handed back in the
 * teardown.
 *
 * Skipping that teardown is not a tidiness problem. A leaked WebGL context per visit reaches
 * the browser's limit at around sixteen, and it starts dropping the OLDEST one: the bug then
 * surfaces somewhere else entirely, long after the cause.
 *
 * This is the largest of the four, and most of what it attaches lives in `ui/ui.ts` rather
 * than here — which is why `createUi()` returns a `dispose()` that this teardown calls.
 */

import { BRAND } from '@vostok/brand';
import '@vostok/ui-kit/styles.css';
import '@vostok/fonts/fonts.css';
import '@vostok/plates/plates.css';
import {
  topbarLinks, isDesktop, promptDialog, hostAssetUrl, rememberFile, bindExternalLinks,
  chooseFile, listRow, licenseAfterExport, applyTheme, createStore, readProjectFile,
} from '@vostok/ui-kit';
import './style.css';
import { createViewer, type SectionAxis } from './viewer/viewer';
import { mountPlatePicker } from '@vostok/plates';
import { downloadFile } from '@vostok/export';
import { createUi, type UiState } from './ui/ui';
import { loadFileToImage, processImage, type RgbaImage } from '@vostok/laser/trace';
import { runWizard } from './ui/wizard';
import { buildThreeMF, downloadThreeMF } from './export/threemfExport';
import { assemblyMinZ, groupBBox, plateWarnings } from './export/plateLayout';
import { buildObjMtl, objToArrayBuffer } from './export/objExport';
import { STEM_FIT_MAX_MM, STEM_FIT_MIN_MM, STEM_FIT_STEP_MM } from './geometry/stemFit';
import { FIT_TEST_FONT_ID, FIT_TEST_STEP_MM, fitTestLabel, fitTestLadder } from './geometry/fitStrip';
import { parseSvg, type SvgOptions } from './image/logo';
import { openSvgPreview } from './ui/svgPreview';
import { allShapes, findShape, loadPackShapes } from './shapes/directory';
// The shape editor, a paid feature fenced in src/pro/, is imported dynamically from
// `virtual:shape-editor` inside `openShapeEditorForState`, behind `__SHAPE_EDITOR__`.
// Paid features. Resolves to a no-op stub outside the MakerWorld build — see vite.config.ts.
import { mountProFeatures, type ProPanel } from 'virtual:pro-pack';
import { SAMPLES, SVG_SAMPLES } from './image/sample';
import {
  alphabetOf, currentFontIdOf, ensureFont, facesThatWrite, fontOptions, fontWritesText, parseLetter, parseBlockChain,
  importFontFile,
} from './image/letter';
import {
  arrangeBlocks, blockBuildParams, changeLayout, gridFor, isSymbolChar, lineSymbols, loadedBlocks, loadedSymbols,
  presetText, pruneSymbols, resizeCells, toggleKey, tracedSymbols,
} from './geometry/blockLayout';
import { LUCIDE_ICONS, buildSvg } from './image/lucideIcons';
// MakerLab integration seam. Resolves to a no-op stub in the public build and to the host
// glue in the MakerWorld build (`--mode makerworld`) — see vite.config.ts.
import {
  MAKERLAB,
  SELLER_PACK,
  ensureAccess,
  initMakerlab,
  isReady as mlReady,
  can as mlCan,
  sdkExport,
  sdkToast,
} from 'virtual:makerlab';
import type {
  BuildParams,
  BuildRegion,
  ClickerPart,
  EdgeStyle,
  GeometryResponse,
  PaletteEntry,
  RegionSet,
  RGB,
  Ring,
  SwitchPlacement,
  ViewMode,
} from './types';
import { FILAMENTS, type PreprocessParams } from './types';

import type { DesktopHost } from '@vostok/ui-kit';
import { closeAllDialogs, dialog, toast } from '@vostok/ui-kit';
import { setAssetBase, assetBase } from './assets';
import { TEMPLATE } from './template';
import { createModelMode, type ModelMode } from './ui/modelMode';
import { DEFAULT_MODEL_CUT } from './model/types';
import type { SampleId } from './model/samples';
import { deflateSync, inflateSync } from 'fflate';

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
  // The container is the app's layout column — see `.cg-mount` in style.css. It has to be
  // set here rather than on `#root` in index.html, because on the desktop host there is no
  // index.html and the container is an element the host owns.
  container.classList.add('cg-mount');
  container.innerHTML = TEMPLATE;

  /** Everything the teardown has to undo, in the order it was set up. */
  const cleanups: (() => void)[] = [];


  // Mount the unified Vostok topbar — except in the MakerWorld build, which has no outbound
  // links; the host owns navigation and draws its own chrome.
  const oldTopbar = container.querySelector('#topbar');
  if (oldTopbar) {
    if (MAKERLAB || isDesktop()) {
      oldTopbar.remove();
    } else {
      oldTopbar.replaceWith(topbarLinks({
        githubUrl: BRAND.urls.github,
        boostUrl: BRAND.urls.makerworld,
      }));
    }
  }

  // Start fetching switch assets immediately at startup to run in parallel with worker setup
  // Read once, here, rather than at module scope: `setAssetBase()` above has already run,
  // and a module-level const would have been evaluated at import time — before it.
  const base = assetBase();
  const assetsPromise = Promise.all([
    fetch(base + 'assets/switch/mx/mx-socket.3mf').then((r) => r.arrayBuffer()),
    fetch(base + 'assets/switch/mx/mx-stem.3mf').then((r) => r.arrayBuffer()),
    fetch(base + 'assets/switch/mx/mx-switch.3mf').then((r) => r.arrayBuffer()),
    // Letter blocks need only the keycap: their bodies are generated (geometry/keyBody.ts).
    fetch(base + 'assets/keycap.json').then((r) => r.json()),
  ]).catch((err) => {
    console.error('[assets] Pre-fetch failed:', err);
    throw err;
  });

  /** Which editable color a clicked model part maps back to. */
  type ColorTarget =
    | { kind: 'region'; index: number; compIndex: number }
    | { kind: 'body' }
    | { kind: 'base' }
    /** Exactly one named part — a single keycap or a single letter picked in the viewport. */
    | { kind: 'part'; name: string };

  /** Symmetric default placement layout for 1..3 switches, spread across the cap width. */
  function defaultSwitchLayout(n: number, capWidthMm: number): SwitchPlacement[] {
    if (n <= 1) return [{ x: 0, y: 0, rotation: 0 }];
    if (n === 2) {
      const x = Math.max(9, capWidthMm / 4);
      return [{ x: -x, y: 0, rotation: 0 }, { x, y: 0, rotation: 0 }];
    }
    const p = Math.max(17, capWidthMm / 3);
    return [{ x: -p, y: 0, rotation: 0 }, { x: 0, y: 0, rotation: 0 }, { x: p, y: 0, rotation: 0 }];
  }

  // ---- State (UI-facing) ----
  const store = createStore<UiState>({
    status: 'Loading switch assets…',
    building: false,
    hasParts: false,
    // Set once the default clicker (or its dynamic fallback) actually lands — see
    // `loadDefaultClicker` — never here, where nothing has loaded yet.
    loadedSampleId: null,
    colorCount: 4,
    palette: [],
    baseShape: 'outline',
    capWidthMm: 35,
    topThickness: 1.5,
    imageDepth: 0.8,
    capProud: 4.0,
    hollowBase: false,
    fixedSize: null,
    designScale: 1,
    shapeSides: 6,
    shapeCornerPct: 0.22,
    shapeArmPct: 0.34,
    packShapeToken: null,
    drawnShapeId: null,
    builtBodyMm: null,
    tolerance: 0.4,
    stemFitMm: 0,
    fitTestActive: false,
    fitTestStepMm: FIT_TEST_STEP_MM,
    socketFitPct: 0,
    switches: [{ x: 0, y: 0, rotation: 0 }],
    activeSwitchIndex: 0,
    smoothing: 0.1,
    keychain: { enabled: false, style: 'loop', angleDeg: 90, holeDiameterMm: 5.2, offsetMm: 0 },
    removeBg: true,
    view: 'exploded',
    showSwitch: true,
    // Cut-open state. Viewport only: not in HISTORY_FIELDS, not in a saved project.
    sectionOn: false,
    sectionAxis: 'y' as SectionAxis,
    sectionPos: 0,
    importMode: 'image', // Land on the Image tab by default
    // Model mode (src/model/): how an uploaded 3D model is cut, what the import made of it,
    // and what the last build reported. Only `modelCut` is a design field (undo, save).
    modelCut: DEFAULT_MODEL_CUT,
    modelInfo: null,
    modelMeta: null,
    currentIconName: 'circle',
    colorMode: 'normal',
    limitedColors: [],
    bodyColorRgb: [240, 240, 240] as RGB,
    paletteOverrides: [],
    baseColorOverride: null,
    imageOffset: { x: 0, y: 0 },
    partOverrides: {},
    customColors: [],
    editMode: 'color',
    edgeSettings: [
      { target: 'capTop', style: 'chamfer', radius: 0.5 },
      // One control for the whole clicker base — bevels top + bottom body edges together.
      { target: 'clickerBase', style: 'chamfer', radius: 0.5 },
    ],
    extrudeChamfer: false,
    separateLetters: false,
    lineSpacing: 1,
    letterSpacing: 0,
    textBold: 0,
    textScale: 1,
    textSizeMul: 1,
    // ---- Letter blocks ----
    blockLayout: 'row',
    blockGridRows: 3,
    blockGridCols: 3,
    blockCells: null,
    blockLines: ['Name'],
    blockSymbols: {},
    textSymbols: {},
    blockStyle: 'walls',
    blockTexture: 'smooth',
    legendScale: 1,
    legendBold: 0,
    keychainEnd: 'left',
    keychainSlideMm: 0,
    extrudeHeight: null,
    componentHeights: {},
    selectedParts: [],
    canUndo: false,
    canRedo: false,
    canRefresh: false,
  });

  // ---- Heavy data kept out of the reactive store ----
  let originalImage: RgbaImage | null = null; // pristine decode (never mutated)
  /* What the wizard was last run ON and WITH, so "Adjust image" can reopen it on the same
     picture with the same sliders instead of starting from the already-adjusted copy (which
     would apply the tone curve twice). */
  let wizardBase: RgbaImage | null = null;
  let wizardParams: PreprocessParams | null = null;
  /** The paid panel, in the MakerWorld build only. Null everywhere else, and the `?.` at
   *  every call site is what makes "the paid features are simply not in this build" the
   *  default rather than a special case. */
  let proPanel: ProPanel | null = null;

  /* ------------------------------------------------------- MakerLab handshake

     FIRST: nothing here needs the UI, and everything that shows a price or ownership waits on
     it. `store` exists (it is built above), and every consumer re-checks `isReady()` at the
     moment it acts rather than capturing anything now. */
  if (MAKERLAB) {
    initMakerlab({
      onDisconnect: () => store.set({ status: 'Disconnected from the MakerLab host.' }),
    }).then((ctx) => {
      if (!ctx) return;
      console.log('[MakerLab] connected');
      /* Repaint now: ownership and price are unknown until connected, and `mount()` paints the
         sidebar synchronously, before this resolves. The panel only repaints on store changes,
         so it would otherwise wait for the user to move a control. */
      proPanel?.refresh();
    });
  }
  /** Rings of the seasonal-pack silhouette in use, if any. Out of the store deliberately: it
   *  is thousands of coordinates, it is derived from `packShapeToken`, and every store patch
   *  is a full object spread. */
  let packShapeRings: Ring[] | null = null;
  /** Outlines drawn in the 2-D editor, by the id `UiState.drawnShapeId` carries.
   *
   *  A MAP and not a single variable, and that distinction is the whole fix for a real bug:
   *  the undo history is a JSON snapshot of `HISTORY_FIELDS`, so it can restore
   *  `baseShape: 'custom'` from three edits ago — and with one variable, the points it wanted
   *  had already been overwritten by whatever was drawn since. `buildClicker` falls back to a
   *  circle when the rings are missing, so undo turned a drawn shape into a plain disc, and
   *  saving after that wrote the disc to the project file. Nothing errored.
   *
   *  Bounded by how many shapes one session draws — a handful of rings, kept for as long as
   *  the undo history that might still ask for them. */
  const drawnRings = new Map<string, Ring[]>();
  let drawnSeq = 0;
  const rememberDrawing = (rings: Ring[]): string => {
    const id = `draw-${++drawnSeq}`;
    drawnRings.set(id, rings);
    return id;
  };
  /** The rings behind whatever the state currently points at, or null. One place asks this
   *  question so the two sources cannot be confused at a call site. */
  const ringsForState = (s: UiState): Ring[] | null => {
    if (s.baseShape !== 'custom') return null;
    if (s.packShapeToken) return packShapeRings;
    return s.drawnShapeId ? drawnRings.get(s.drawnShapeId) ?? null : null;
  };
  /** The clear square an MX switch needs, mm. Reported by the worker off the socket asset at
   *  init, so the shape editor and the build's `switchClear` use the same measurement. The
   *  seed is the shipped socket's own figure and is only ever used in the sliver of time before
   *  `initDone` lands, which is well before the editor can be opened. */
  let switchColumnMm = 17;
  let regionSet: RegionSet | null = null;
  let latestParts: ClickerPart[] = [];
  let assetsReady = false;
  let defaultClickerLoaded = false;

  // Vector states
  let currentSvgText = '';
  /** How the current SVG should be traced, as chosen in the import preview: which parts to
   *  keep, what colour each is, and whether outlines get filled. Kept beside the text rather
   *  than in the store because it belongs to the FILE, not to the design. */
  let currentSvgOptions: SvgOptions = {};
  let currentSvgName = '';
  let currentIconText = '';
  let currentIconName = '';
  /** The name of the picture the user brought in, kept only so the export can be called after
   *  it. `loadedSampleId` cannot do this job: it names the SELECTED TILE, and an upload
   *  correctly clears it — which left every design a user actually made exporting as the bare
   *  `clicker.3mf` while only the demos got a real name. */
  let currentImageName = '';
  let currentText = 'Custom\nText';
  let currentFontId = 'helvetiker-regular';
  /** The latest font pick, so a slow load cannot overwrite a newer choice. */
  let fontPick = 0;
  /**
   * Letters the chosen face cannot draw would print as "?", so typing them moves the text to the
   * plainest face that can (Standard has no Cyrillic, say) and says so. Only typing does this: a
   * face picked by hand for a text it cannot write keeps its ⚠ mark and stays picked.
   */
  function fitFontTo(text: string): void {
    if (fontWritesText(currentFontId, text)) return;
    const next = facesThatWrite(text)[0];
    if (!next || next === currentFontId) return;
    const name = (id: string) => fontOptions().find((f) => f.id === id)?.name ?? id;
    const alphabet = alphabetOf(text);
    toast(`${name(currentFontId)} has no ${alphabet ? `${alphabet} letters` : 'letters for that'}, so the text is set in ${name(next)}.`);
    currentFontId = next;
    ui.setFont(next);
    const pick = ++fontPick;
    void ensureFont(next).then((ok) => {
      if (ok && pick === fontPick) reprocess();
    });
  }
  let isInitialLoad = true;

  /* The name a downloaded file gets.
     Every export used to be the literal `clicker.3mf`, so filling five orders in an evening
     left you with clicker.3mf, clicker(1).3mf, clicker(2).3mf and no way to tell which was
     whose. The name now comes from whatever identifies the design in the mode it was made
     in, and falls back to the old literal when nothing does, so nothing that had a good name
     before loses one.
     The slug is local on purpose. The only other one in this app lives in `src/pro/`, which
     is paid, gitignored source excluded from the public bundle — importing it from free code
     would either break a fresh public clone's build or quietly bundle paid source into the
     public site. */
  const slugify = (s: string, max = 28): string =>
    s
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max)
      .replace(/-+$/g, '')
      .toLowerCase();

  function designFileBase(): string {
    const s = store.get();
    let label = '';
    switch (s.importMode) {
      case 'text':
        label = Array.from(currentText).filter((ch) => !isSymbolChar(ch)).join('');
        break;
      case 'blocks':
        // What is printed on the keys, symbols left out (they have no name worth a file).
        label = Array.from(s.blockLines.join(' ')).filter((ch) => !isSymbolChar(ch)).join('').trim();
        break;
      case 'svg':
        label = currentSvgName;
        break;
      case 'icon':
        label = currentIconName;
        break;
      case 'model':
        label = modelMode.fileLabel();
        break;
      case 'image':
        // The tile's name when a sample is what's loaded, the user's own filename otherwise.
        label = s.loadedSampleId ?? currentImageName;
        break;
    }
    const slug = slugify(label);
    return slug ? `clicker-${slug}` : 'clicker';
  }

  /** A clicker cut from an uploaded model says whose shape it is (threemfExport's `sourceModel`).
   *  Not for the fit test, which is ours alone. */
  function modelExportOpts(): { sourceModel?: string } {
    const s = store.get();
    if (s.importMode !== 'model' || s.fitTestActive) return {};
    return { sourceModel: modelMode.snapshot()?.name ?? 'an uploaded model' };
  }

  /** Base64 without a FileReader round trip. Chunked because `String.fromCharCode(...bytes)`
   *  blows the argument limit on anything bigger than a small image. */
  function bytesToBase64(bytes: Uint8Array): string {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }

  /** The two cover sizes a 3MF carries: the card image, and the list-row thumbnail. A failed
   *  capture is not a failed export — it just means this file has no cover. */
  async function coverImages() {
    const coverPng = (await viewer.renderCoverPng()) ?? undefined;
    if (!coverPng) return {};
    return { coverPng, coverSmallPng: await shrinkPng(coverPng, 128) };
  }

  /** The list-row thumbnail, by downscaling the cover rather than taking a second shot.
   *  A second WebGL capture costs another framebuffer reallocation — measured at ~2s under
   *  software rendering, and the same cost at 128px as at 512px, since it is the realloc and
   *  not the pixels — and a 128px render aliases far worse than a filtered downscale of one.
   *  Undefined on failure; the exporter then falls back to the full-size cover. */
  async function shrinkPng(png: Uint8Array, edge: number): Promise<Uint8Array | undefined> {
    try {
      const bmp = await createImageBitmap(new Blob([png as unknown as BlobPart], { type: 'image/png' }));
      const c = document.createElement('canvas');
      c.width = edge;
      c.height = edge;
      const g = c.getContext('2d')!;
      g.imageSmoothingQuality = 'high';
      g.drawImage(bmp, 0, 0, edge, edge);
      bmp.close();
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
      return blob ? new Uint8Array(await blob.arrayBuffer()) : undefined;
    } catch {
      return undefined;
    }
  }

  const hasImage = () => originalImage !== null;
  function cloneImage(img: RgbaImage): RgbaImage {
    return { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height };
  }

  // ---- DOM / subsystems ----
  // Scoped to the container: two generators can be mid-teardown and mid-mount at once,
  // and a bare getElementById would happily find the other one's node.
  const sidebarLeft = container.querySelector<HTMLElement>('#sidebar-left')!;
  const sidebarRight = container.querySelector<HTMLElement>('#sidebar-right')!;
  const statusEl = container.querySelector<HTMLElement>('#status')!;
  const viewer = createViewer(container.querySelector<HTMLElement>('#app')!);
  cleanups.push(() => viewer.dispose());

  // Build plate picker (top-right of the stage); the plate is shared across generators.
  mountPlatePicker(document.getElementById('viewport')!, viewer);

  // ---- Sync the 3D viewport to the active theme ----
  // index.html's bootstrap and the ui-kit sidebar-footer theme toggle both own
  // <html data-theme> (key 'clicker_theme'). Mirror it into the viewer on load and
  // whenever the toggle flips it, per the ui-kit "observe data-theme" pattern.
  (function syncViewerTheme() {
    const readTheme = () => document.documentElement.getAttribute('data-theme') || 'dark';
    viewer.setTheme(readTheme());
    const themeObserver = new MutationObserver(() => viewer.setTheme(readTheme()));
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    cleanups.push(() => themeObserver.disconnect());
  })();

  // Model mode's controller, created straight after the UI it mounts into (see below). Declared
  // here because the UI's callbacks reach it, and they only ever run after it exists.
  let modelMode!: ModelMode;

  // The preview's own settings. Named, because two sets of controls drive them: the rail's
  // Preview & view section, and — in Model mode, where that section hides — the stage's.
  function setViewMode(mode: ViewMode) {
    store.set({ view: mode });
    viewer.setView(mode);
  }
  function setSectionOn(on: boolean) {
    store.set({ sectionOn: on });
    // Push the axis/position the two controls are showing before turning the cut on, so it
    // lands where the UI says rather than wherever the viewer was last told.
    const st = store.get();
    viewer.setSection(st.sectionAxis, st.sectionPos);
    viewer.setSectionEnabled(on);
  }
  function setShowSwitch(on: boolean) {
    store.set({ showSwitch: on });
    // The fit test has no switch to show; the setting applies again on the way back.
    viewer.showSwitch(on && !store.get().fitTestActive);
  }

  const ui: ReturnType<typeof createUi> = createUi(sidebarLeft, sidebarRight, statusEl, {
    onUpload: (file) => {
      // Kept the moment it arrives rather than when a project is saved: save is a thing
      // the user can forget, importing is a thing they just did. No-op without a host.
      void rememberFile(host, 'image', file);
      // The picture is the user's own now, not any sample tile's — clear the mark immediately
      // rather than waiting for the build to settle, since an upload that fails to decode
      // must not leave a stale sample looking selected either (audit #2).
      store.set({ loadedSampleId: null });
      // Drop the extension: `samurai-mask.png` should export as `clicker-samurai-mask.3mf`,
      // not `clicker-samurai-mask-png.3mf` — the slug turns the dot into a hyphen.
      currentImageName = file.name.replace(/\.[^.]+$/, '');
      openWizard(() => loadFileToImage(file));
    },
    onSample: (load, label) => {
      // `label` is the sample/pack design's own name now, handed straight through by
      // `onSample`'s caller in ui.ts — no more guessing it back from the loader function by
      // reference equality, which only ever worked for the six bundled samples (a pack design
      // is a fresh `() => loadDesignImage(pack, design)` closure every time, and no comparison
      // could name it from here).
      pendingSampleLoadName = label ?? null;
      openWizard(load);
    },
    onCustomColor: (hex) => rememberColour(hexToRgb(hex)),
    onAdjustImage: () => {
      // The same wizard, on the picture it last confirmed. A sample loaded at startup never
      // went through it, so that falls back to the pristine decode with default sliders.
      const base = wizardBase ?? originalImage;
      if (!base) {
        store.set({ status: 'Load an image first.' });
        return;
      }
      if (store.get().importMode !== 'image') return;
      void openWizard(() => Promise.resolve(base));
    },
    onColorCount: (n) => {
      // A count picked here overrides the wizard's kept-colour list: the picture is split
      // automatically into that many again. The list is still one "Adjust image" away.
      store.set({ colorCount: n, colorMode: 'normal', limitedColors: [] });
      debouncedReprocess();
    },
    onFilament: (i, hex) => {
      // Live recolor (same path as clicking the color on the 3D model). A color change
      // never changes geometry, so we skip the full worker rebuild — picking a filament
      // in the left menu now behaves exactly like recoloring in Color mode.
      if (!store.get().palette[i]) return;
      applyModelRecolor({ kind: 'region', index: i, compIndex: 0 }, hexToRgb(hex), -1);
    },
    onResetPartColors: () => {
      const s = store.get();
      if (Object.keys(s.partOverrides ?? {}).length === 0) return;
      store.set({ partOverrides: {} });
      // Repaint live rather than rebuilding — colour never changes geometry. The base a
      // shape falls back to is the one `rebuild` would give it: its palette row, or the
      // single "Letters" row when this is a block chain.
      const blocks = s.importMode === 'blocks';
      const capBase = s.baseColorOverride ?? deriveFrameColor(s);
      latestParts.forEach((p, idx) => {
        let base: RGB | undefined;
        const m = /^top-color-(\d+)-\d+$/.exec(p.name);
        if (m) {
          const i = blocks ? 0 : +m[1];
          base = s.palette[i]?.filamentRgb ?? regionSet?.regions[i]?.quantRgb;
        } else if (/^cap-\d+$/.test(p.name)) {
          base = capBase;
        }
        if (!base) return;
        latestParts[idx] = { ...latestParts[idx], colorRgb: base };
        viewer.setPartColor(idx, base);
      });
      syncBaseColor();
    },
    onShape: (kind) => {
      // Leaving a pack shape clears its token, or a later reload would restore a base the
      // picker is no longer pointed at.
      store.set({ baseShape: kind, packShapeToken: kind === 'custom' ? store.get().packShapeToken : null });
      debouncedRebuild();
    },
    onWidth: (mm) => {
      store.set({ capWidthMm: mm });
      debouncedRebuild();
    },
    onTopThickness: (mm) => {
      store.set({ topThickness: mm });
      debouncedRebuild();
    },
    onImageDepth: (mm) => {
      store.set({ imageDepth: mm });
      debouncedRebuild();
    },
    onFitTest: () => enterFitTest(),
    onFitTestExit: () => exitFitTest(),
    onFitTestStep: (mm) => {
      store.set({ fitTestStepMm: mm });
      showFitStrip();
    },
    onHollowBase: (on) => {
      store.set({ hollowBase: on });
      debouncedRebuild();
    },
    onFixedSize: (size) => {
      store.set({ fixedSize: size });
      debouncedRebuild();
    },
    onDesignScale: (v) => {
      store.set({ designScale: v });
      debouncedRebuild();
    },
    onShapePick: (id) => {
      const entry = findShape(id);
      if (!entry) return;
      // Three kinds of shape, one entry point. A built-in carries a `kind` that goes straight
      // into `baseShape`; a library or pack shape carries rings and rides the `custom` seam
      // that already existed for packs. The picker never has to know which is which.
      if (entry.kind) {
        store.set({
          baseShape: entry.kind,
          packShapeToken: null,
          drawnShapeId: null,
          // A shape brings its own defaults, so picking "Star" gives a five-point star rather
          // than whatever the previous shape's knob happened to be sitting on.
          ...(entry.param ? { shapeSides: entry.param.value } : {}),
          ...(entry.corner ? { shapeCornerPct: entry.corner.value / 100 } : {}),
          // The third knob, which this had been missing: without it a Cross picked after a
          // Star inherited the star's 0.56 sharpness as its arm width — a legal number for
          // the field and the wrong shape on screen, with nothing saying why.
          ...(entry.feature ? { shapeArmPct: entry.feature.value / 100 } : {}),
        });
      } else if (entry.rings?.length) {
        packShapeRings = entry.rings;
        store.set({ baseShape: 'custom', packShapeToken: entry.id, drawnShapeId: null });
      } else {
        return;
      }
      debouncedRebuild();
    },
    /* The three parametric knobs, driven from the picker.

       Clamped here and not only in the UI: these are the values that go into the build, and
       a control is not the only thing that can set one — a loaded project carries them too. */
    onShapeSides: (n) => {
      // 3..8, which is what `buildClicker` itself clamps to — `sides(5, 3, 8)` for a star and
      // `sides(6, 3, 8)` for a polygon. Clamping wider here would let a loaded project store a
      // 10 that renders as an 8: a control that moves, fires a rebuild and changes nothing,
      // which is the complaint this whole pass is about, re-created inside its own remedy.
      store.set({ shapeSides: Math.round(Math.max(3, Math.min(8, n))) });
      debouncedRebuild();
    },
    onShapeCorner: (pct) => {
      store.set({ shapeCornerPct: Math.max(0, Math.min(0.5, pct)) });
      debouncedRebuild();
    },
    onShapeArm: (pct) => {
      store.set({ shapeArmPct: Math.max(0.1, Math.min(0.9, pct)) });
      debouncedRebuild();
    },
    onEditShape: () => { void openShapeEditorForState(); },
    onCapProud: (mm) => {
      // The builder clamps this against the available border height, so a value that cannot
      // fit simply lands at the maximum rather than breaking the bezel.
      store.set({ capProud: mm });
      debouncedRebuild();
    },
    // The three fit controls, each on a different pair of surfaces. They used to be two, one
    // of which was named after a part it never touched — see the UI for the naming.
    onGapTolerance: (mm) => {
      // Top ↔ base: the slip fit between the cap's skirt and the body's well.
      store.set({ tolerance: Math.round(Math.max(0.1, Math.min(1.0, mm)) * 100) / 100 });
      debouncedRebuild();
    },
    onStemFit: (mm) => {
      // Cap stem ↔ switch stem: opens or closes the cross hole in the cap's post.
      const clamped = Math.max(STEM_FIT_MIN_MM, Math.min(STEM_FIT_MAX_MM, mm));
      store.set({ stemFitMm: Math.round(Math.round(clamped / STEM_FIT_STEP_MM) * STEM_FIT_STEP_MM * 100) / 100 });
      // While the fit test is showing, the tiles are what is on screen and they are centred on
      // this number. The design catches up when the preview goes back to it.
      if (store.get().fitTestActive) {
        designStale = true;
        debouncedFitStrip();
      } else {
        debouncedRebuild();
      }
    },
    onSocketFit: (pct) => {
      // Body pocket ↔ switch body: how tightly the switch itself sits in the base.
      store.set({ socketFitPct: Math.round(Math.max(-5, Math.min(5, pct)) * 10) / 10 });
      debouncedRebuild();
    },
    onSwitchNudge: (dx, dy) => {
      // Move only the active switch. Bound the requested offset; the worker does the
      // precise clamp to the cap footprint + min-pitch and reports the applied
      // placements back (moving the preview switches).
      const LIMIT = 15;
      const clamp = (v: number) => Math.max(-LIMIT, Math.min(LIMIT, v));
      const s = store.get();
      const i = Math.min(s.activeSwitchIndex, s.switches.length - 1);
      const switches = s.switches.map((sw, idx) =>
        idx === i ? { ...sw, x: clamp(sw.x + dx), y: clamp(sw.y + dy) } : sw,
      );
      store.set({ switches });
      debouncedRebuild();
    },
    onSwitchRotate: (deltaDeg) => {
      // Rotate only the active switch a couple of degrees per press; clamp so the socket
      // stays sensibly aligned with the design.
      const s = store.get();
      const i = Math.min(s.activeSwitchIndex, s.switches.length - 1);
      const switches = s.switches.map((sw, idx) =>
        idx === i ? { ...sw, rotation: Math.round(Math.max(-30, Math.min(30, sw.rotation + deltaDeg))) } : sw,
      );
      store.set({ switches });
      debouncedRebuild();
    },
    onSwitchReset: () => {
      // Recenter only the active switch to its default slot for the current count.
      const s = store.get();
      const layout = defaultSwitchLayout(s.switches.length, s.capWidthMm);
      const i = Math.min(s.activeSwitchIndex, s.switches.length - 1);
      const switches = s.switches.map((sw, idx) => (idx === i ? layout[idx] : sw));
      store.set({ switches });
      debouncedRebuild();
    },
    onSwitchCount: (n) => {
      // Changing count replaces the whole array with the symmetric default layout
      // (users re-tune after); keeps the logic simple and always well-spaced.
      const s = store.get();
      if (n === s.switches.length) return;
      store.set({ switches: defaultSwitchLayout(n, s.capWidthMm), activeSwitchIndex: 0 });
      debouncedRebuild();
    },
    onActiveSwitch: (i) => {
      // Selection only — no rebuild.
      store.set({ activeSwitchIndex: i });
    },
    onSwitchResetAll: () => {
      const s = store.get();
      store.set({
        switches: defaultSwitchLayout(s.switches.length, s.capWidthMm),
        activeSwitchIndex: 0,
      });
      debouncedRebuild();
    },
    onKeychainReset: () => {
      // 90° is +Y, the top of the body — where a hanger looks deliberate.
      store.set({ keychain: { ...store.get().keychain, angleDeg: 90, offsetMm: 0 } });
      debouncedRebuild();
    },
    onKeychainToggle: (on) => {
      store.set({ keychain: { ...store.get().keychain, enabled: on } });
      debouncedRebuild();
    },

    onKeychainAngle: (deg) => {
      // Absolute now — the slider that replaced the rotate d-pad always reports the value it
      // shows, so there is no delta to accumulate the way the old `onKeychainRotate` did.
      const kc = store.get().keychain;
      const angleDeg = ((deg % 360) + 360) % 360;
      store.set({ keychain: { ...kc, angleDeg } });
      debouncedRebuild();
    },
    onKeychainSize: (deltaMm) => {
      const kc = store.get().keychain;
      const holeDiameterMm = Math.round(Math.max(3.0, Math.min(8.0, kc.holeDiameterMm + deltaMm)) * 10) / 10;
      store.set({ keychain: { ...kc, holeDiameterMm } });
      debouncedRebuild();
    },
    onKeychainOffsetSet: (mm) => {
      // Absolute, same reasoning as `onKeychainAngle` above.
      const kc = store.get().keychain;
      const offsetMm = Math.round(Math.max(-15.0, Math.min(15.0, mm)) * 10) / 10;
      store.set({ keychain: { ...kc, offsetMm } });
      debouncedRebuild();
    },
    onSmoothing: (v) => {
      store.set({ smoothing: v });
      if (store.get().importMode === 'image' && hasImage()) debouncedReprocess();
    },
    onRemoveBg: (on) => {
      store.set({ removeBg: on });
      const mode = store.get().importMode;
      if (mode === 'image' && hasImage()) reprocess();
      else if (mode === 'svg' && currentSvgText) reprocess();
    },
    onView: setViewMode,
    onSectionEnabled: setSectionOn,
    onShowSwitch: setShowSwitch,
    onSection: (axis, pos) => {
      // The store has to carry it too: the two controls seed themselves from state on every
      // sync, so a value the viewer knows and the store does not gets reverted on the next
      // rebuild.
      store.set({ sectionAxis: axis, sectionPos: pos });
      viewer.setSection(axis, pos);
    },
    onExport: async () => {
      // With the fit test showing, Export sends the tiles. Same paths as the design on purpose:
      // the MakerLab route, the cover and the licence nudge all come with it.
      const fitTest = store.get().fitTestActive;
      const parts = fitTest ? fitStripParts : latestParts;
      if (!parts.length) return;
      const fileBase = fitTest ? 'clicker-stem-fit-test' : designFileBase();
      if (MAKERLAB && mlReady() && mlCan('export')) {
        // Embedded path: hand the host an OBJ (one `o` object per colour region) plus an MTL
        // carrying those colours.
        const status = (msg: string) => store.set({ status: msg });
        status('Sending to MakerLab…');
        try {
          const { obj, mtl } = buildObjMtl(parts, 'clicker.mtl');
          // The same framed cover the downloaded 3MF gets. This used to be a bare
          // `canvas.toDataURL()` with no render in front of it — it survived only because the
          // renderer keeps its drawing buffer, and it handed MakerWorld the whole viewport:
          // build plate, grid, and the model wherever the user had last dragged it.
          const png = await viewer.renderCoverPng();
          const coverImage = png ? 'data:image/png;base64,' + bytesToBase64(png) : '';
          const result = await sdkExport({
            artifacts: [
              {
                fileName: `${fileBase}.obj`,
                format: 'obj',
                buffer: objToArrayBuffer(obj),
                mtl,
                coverImage,
                description: fitTest
                  ? 'Switch stem fit test tiles, made with the Clicker Generator.'
                  : 'Multi-color clicker, made with the Clicker Generator.',
              },
            ],
          });
          if (result.success) {
            status('Exported to MakerLab ✓');
            sdkToast({ message: fitTest ? 'Fit test exported' : 'Clicker exported', type: 'success' });
          } else {
            status(`Export failed: ${result.errorMessage ?? result.errorCode}`);
            sdkToast({ message: 'Export failed', type: 'error' });
          }
        } catch (err) {
          status('Export error: ' + String(err));
          console.error('[MakerLab export]', err);
        }
      } else if (host) {
        // With a host the file goes to the host's own export path rather than the browser's
        // download bar.
        try {
          const name = `${fileBase}.3mf`;
          const { indexed } = await host.exportToLibrary(
            { name, bytes: buildThreeMF(parts, { ...(await coverImages()), ...modelExportOpts() }) },
            { designer: 'Clicker Generator' },
          );
          store.set({ status: indexed ? 'Exported to your library ✓' : `Exported as ${name} ✓` });
        } catch (err) {
          store.set({ status: 'Export failed: ' + String(err) });
        }
      } else if (MAKERLAB) {
        /* Embedded, but the host is not answering.

           The embedded build has no download path and no outbound links, so there is no
           fallback download and no licence nudge here (the kit's modal guards on `isDesktop()`,
           never on MAKERLAB). Say what is actually true instead. `initMakerlab` has no
           reconnect, so once the handshake has failed this is the state for the rest of the
           session — the message has to send the user somewhere, and a reload is the only thing
           that re-runs it. */
        store.set({
          status: 'Not connected to MakerLab, so the file cannot be sent. Reload the page and try again.',
        });
      } else {
        // Standalone / public path: direct browser download + license reminder.
        // The cover goes in the file, so a folder of orders shows what each one is instead of
        // forty identical 3MF icons.
        downloadThreeMF(latestParts, `${designFileBase()}.3mf`, { ...(await coverImages()), ...modelExportOpts() });
        // First download on the page: the full licence window. Later ones: the corner reminder.
        licenseAfterExport();
      }
    },
    onRenderPng: async () => {
      const blob = await viewer.renderToPng();
      if (!blob) return;
      if (host) {
        // Not a browser download: through the host it goes where every other export goes.
        // It is a PNG rather than a mesh, so the host will not index it as a model — the
        // status says what actually happened.
        try {
          const { path, indexed } = await host.exportToLibrary({
            name: `${designFileBase()}-render.png`,
            bytes: new Uint8Array(await blob.arrayBuffer()),
          });
          store.set({ status: indexed ? 'Render added to your library ✓' : `Render saved to ${path} ✓` });
        } catch (err) {
          store.set({ status: 'Could not save the render: ' + String(err) });
        }
        return;
      }
      downloadFile(blob, `${designFileBase()}-render.png`, 'image/png');
    },
    onAiPrompt: async () => {
      try {
        await navigator.clipboard.writeText(AI_PROMPT);
        store.set({ status: 'AI image prompt copied to clipboard ✓' });
      } catch {
        store.set({ status: 'Could not copy, see console.' });
        console.log(AI_PROMPT);
      }
    },
    hostOwnsProjects: Boolean(host?.registerProject),
    // Only when the host actually has a picker. Providing this unconditionally would hand
    // the web build a picker that resolves null and never opens the file input, which is a
    // dead Import button and exactly the kind of break these capabilities are optional to
    // avoid.
    pickFile: host?.pickMedia
      ? (kind, extensions) => chooseFile(host, { kind, extensions }, () => {})
      : undefined,
    onSaveProject: () => {
      const proj = buildProject();
      if (host) { void saveToHost(proj); return; }

      downloadFile(JSON.stringify(proj), 'clicker-project.json', 'application/json');
      store.set({ status: 'Project saved ✓' });
    },
    onLoadProject: (file) => {
      void readProjectFile(file, applyProject).then((loaded) => {
        // Not a project the clicker can open: the kit's toast says so. A file that failed
        // half way through applying must not leave "Loading project…" up behind it.
        if (loaded === null) store.set({ building: false, status: '' });
      });
    },
    onOpenFromHost: () => void openFromHost(),
    onBodyColor: (hex) => {
      // Live recolor of the clicker body — no rebuild (geometry is unchanged). A block
      // chain has no 'base-body' part; its bodies are block-0…block-N, so match either.
      const idx = latestParts.findIndex((p) => p.name === 'base-body' || /^block-\d+$/.test(p.name));
      if (idx >= 0) applyModelRecolor({ kind: 'body' }, hexToRgb(hex), idx);
      else store.set({ bodyColorRgb: hexToRgb(hex) });
    },

    onModelFile: (file) => {
      pendingReframe = true;
      store.set({ editMode: 'color', selectedParts: [] });
      void modelMode.loadFile(file);
    },
    onImportMode: (mode) => {
      const s = store.get();
      pendingReframe = true;
      // Landing on Icon with an Outline base is exactly the case `buildParamsFor` quietly
      // swaps to Circle — flag it here, before the base itself changes, so the build this
      // switch produces can say so (see `pendingIconBaseNote`'s declaration).
      if (mode === 'icon' && s.baseShape === 'outline') pendingIconBaseNote = true;
      store.set({
        importMode: mode,
        baseShape: mode === 'text' ? 'outline' : s.baseShape,
        colorMode: mode !== 'image' ? 'normal' : s.colorMode,
        // Part names differ per mode (blocks vs. one clicker), so a stale selection or a
        // pinned frame colour from the previous mode would apply to the wrong thing.
        selectedParts: [],
        baseColorOverride: null,
        // Model mode has no Raise or Edges: its parts are recoloured by clicking them.
        ...(mode === 'model' ? { editMode: 'color' as const } : {}),
      });
      reprocess();
    },
    onSvgUpload: async (file) => {
      try {
        store.set({ building: true, status: 'Reading SVG…' });
        void rememberFile(host, 'svg', file);
        const svgText = await file.text();
        ui.addUploadedSvg(svgText, file.name.replace(/\.svg$/i, ''));
        store.set({ building: false });
      } catch (err) {
        store.set({ building: false, status: 'Error reading SVG: ' + String(err) });
      }
    },
    onSelectSvg: (svgText, name) => {
      /* Show the file, and what the tracer makes of it, before building anything.
         "SVG import doesn't work" is the most reported problem on the listing, and it is
         almost always the file rather than the tracer: outlines with no fills, parts with no
         paint, or more colours than a printer has filaments. None of it was visible until the
         model came out wrong. Cancelling leaves the current design alone. */
      void openSvgPreview(svgText, name, store.get().removeBg).then((result) => {
        if (!result) return;
        pendingReframe = true;
        currentSvgText = svgText;
        currentSvgName = name;
        currentSvgOptions = result.options;
        reprocess();
      });
    },
    onSelectIcon: (svgText, name) => {
      pendingReframe = true;
      currentIconText = svgText;
      currentIconName = name;
      store.set({ currentIconName: name });
      reprocess();
    },
    onTextChange: (text) => {
      currentText = text;
      fitFontTo(text);
      store.set({ textSymbols: pruneSymbols(store.get().textSymbols, text.split('\n')) });
      debouncedReprocess(); // live rebuild as you type
    },
    onTextSymbols: (next) => {
      store.set({ textSymbols: next });
      debouncedReprocess();
    },
    onBlockSymbols: (next) => {
      store.set({ blockSymbols: next });
      debouncedReprocess();
    },
    // Spacing moves the outlines, so the word is re-traced; boldness is applied in the
    // worker where the mm scale is known, so it only needs a rebuild.
    onLineSpacing: (v) => {
      store.set({ lineSpacing: v });
      debouncedReprocess();
    },
    onLetterSpacing: (v) => {
      store.set({ letterSpacing: v });
      debouncedReprocess();
    },
    onTextBold: (mm) => {
      store.set({ textBold: mm });
      debouncedQuietRebuild();
    },
    onTextScale: (v) => {
      store.set({ textScale: v });
      debouncedRebuild();
    },
    onBlockLayout: (layout) => {
      const s = store.get();
      if (layout === s.blockLayout) return;
      store.set(changeLayout(s, layout));
      debouncedReprocess();
    },
    onBlockGridSize: (rows, cols) => {
      const s = store.get();
      const custom = s.blockLayout === 'custom';
      const before = gridFor(custom ? 'custom' : 'grid', 0, s.blockGridRows, s.blockGridCols, s.blockCells);
      // A grid still showing the keys it started with gets the right count of them for its new
      // size; anything typed is kept as typed.
      const untouched = JSON.stringify(s.blockLines) === JSON.stringify(presetText('grid', s.blockGridRows, s.blockGridCols).lines);
      store.set({
        blockGridRows: rows,
        blockGridCols: cols,
        blockCells: custom ? resizeCells(before, rows, cols) : null,
        ...(untouched && !custom ? { blockLines: presetText('grid', rows, cols).lines } : {}),
      });
      debouncedReprocess();
    },
    onBlockCell: (index) => {
      store.set(toggleKey(store.get(), index));
      debouncedReprocess();
    },
    onBlockLine: (row, text) => {
      const lines = [...store.get().blockLines];
      while (lines.length <= row) lines.push('');
      lines[row] = text;
      fitFontTo(lines.join(' '));
      store.set({ blockLines: lines, blockSymbols: pruneSymbols(store.get().blockSymbols, lines) });
      debouncedReprocess();
    },
    onBlockStyle: (style) => {
      store.set({ blockStyle: style });
      debouncedRebuild();
    },
    onBlockTexture: (texture) => {
      store.set({ blockTexture: texture });
      debouncedRebuild();
    },
    onLegendScale: (v) => {
      store.set({ legendScale: v });
      debouncedQuietRebuild();
    },
    onLegendBold: (mm) => {
      store.set({ legendBold: mm });
      debouncedQuietRebuild();
    },
    onCapColor: (hex) => {
      // The palette sets the WHOLE group: repaint every cap and drop any per-cap colours the
      // user had picked in the viewport, so the menu is always the way back to uniform.
      const rgb = hexToRgb(hex);
      const overrides = { ...(store.get().partOverrides ?? {}) };
      for (const k of Object.keys(overrides)) if (/^cap-\d+$/.test(k)) delete overrides[k];
      store.set({ baseColorOverride: rgb, partOverrides: overrides });
      latestParts.forEach((p, i) => {
        if (p.name === 'top-base' || /^cap-\d+$/.test(p.name)) {
          latestParts[i] = { ...latestParts[i], colorRgb: rgb };
          viewer.setPartColor(i, rgb);
        }
      });
    },
    onKeychainEnd: (side) => {
      // Moving the loop to a different face resets the slide. The slide is measured along the
      // face, so carrying it across would put the loop somewhere the user did not point at —
      // and on a row of blocks the two axes have wildly different ranges.
      store.set({ keychainEnd: side, keychainSlideMm: 0 });
      debouncedRebuild();
    },
    onKeychainSlideSet: (mm) => {
      // Absolute — the slider that replaced the slide d-pad always reports the value it shows.
      // The real limit is half the block pitch, which only the worker knows (pitch is measured
      // off the assets at init and never crosses back). A generous UI bound stops the number
      // running away; buildBlocks clamps for real and warns when it has to.
      const next = Math.max(-40, Math.min(40, mm));
      store.set({ keychainSlideMm: Math.round(next * 10) / 10 });
      debouncedRebuild();
    },
    onKeychainSlideReset: () => {
      store.set({ keychainSlideMm: 0 });
      debouncedRebuild();
    },
    onFontSelect: (fontId) => {
      // A shared face is fetched the first time it is picked; the trace waits for it, and a
      // second pick made while the first is still loading wins.
      currentFontId = fontId;
      const pick = ++fontPick;
      void ensureFont(fontId).then((ok) => {
        if (pick !== fontPick) return;
        if (!ok) {
          store.set({ status: 'That font could not be loaded. Pick another one.' });
          return;
        }
        reprocess();
      });
    },
    importFont: async (file) => {
      // The font block selects what came in and says so; picking it (onFontSelect) builds.
      void rememberFile(host, 'font', file);
      return importFontFile(file);
    },
    host,
    onThemeChange: (theme) => {
      applyTheme(theme === 'light' ? 'light' : 'dark');
      viewer.setTheme(theme);
    },
    onEditMode: (mode) => {
      // Geometry is always kept in sync by the live edit rebuilds. Keep the selection
      // when moving between extrude/edges (so you can raise then bevel the same parts),
      // but clear it entering color mode so no stray highlight tints the swatches.
      store.set({ editMode: mode, selectedParts: mode === 'color' ? [] : store.get().selectedParts });
    },
    onEdgeStyle: (target: string, style: EdgeStyle) => {
      const s = store.get();
      const edgeSettings = [...s.edgeSettings];
      const idx = edgeSettings.findIndex(x => x.target === target);
      if (idx >= 0) {
        const cur = edgeSettings[idx];
        // Picking fillet/chamfer with no size yet gets a sensible default so the
        // result is immediately visible (the old code left radius at 0 = no-op).
        const radius = style !== 'none' && (!cur.radius || cur.radius < 0.2) ? 1.0 : cur.radius;
        edgeSettings[idx] = { ...cur, style, radius };
      } else {
        edgeSettings.push({ target, style, radius: style === 'none' ? 0 : 1.0 });
      }
      store.set({ edgeSettings });
      debouncedQuietRebuild(); // live preview of the bevel
    },
    onEdgeStep: (target: string, delta: number) => {
      const s = store.get();
      const edgeSettings = [...s.edgeSettings];
      const idx = edgeSettings.findIndex(x => x.target === target);
      const current = idx >= 0 ? edgeSettings[idx].radius : 1.0;
      const next = Math.max(0.2, Math.min(5.0, current + delta));
      if (idx >= 0) {
        edgeSettings[idx] = { ...edgeSettings[idx], radius: next };
      } else {
        edgeSettings.push({ target, style: 'chamfer', radius: next });
      }
      store.set({ edgeSettings });
      debouncedQuietRebuild(); // live preview of the bevel size
    },
    onExtrudeStep: (delta: number) => {
      const s = store.get();
      if (s.selectedParts.length === 0) return;
      const componentHeights = { ...s.componentHeights };
      let changed = false;
      for (const partName of s.selectedParts) {
        const current = componentHeights[partName] ?? 0;
        const next = Math.max(-5, Math.min(6, current + delta));
        if (current !== next) {
          componentHeights[partName] = next;
          changed = true;
        }
      }
      if (changed) {
        store.set({ componentHeights });
        // Rebuild for real so the part grows in place (no floating slab) — this IS
        // the preview, and it bakes the height into the exported geometry.
        debouncedQuietRebuild();
      }
    },
    onExtrudeChamfer: (on) => {
      // Global, part-independent toggle: when on, every raised (extruded) color part
      // gets a small beveled top edge. Not tied to the current selection — flip it once
      // and all extruded parts pick up the chamfer (buildClicker applies it per part).
      store.set({ extrudeChamfer: on });
      debouncedQuietRebuild();
    },
    onImageNudge: (dx, dy) => {
      // Clamped to a sane range: past this the base shape has grown so much that the design
      // is a speck in the corner, which is never what someone wants.
      const o = store.get().imageOffset;
      const lim = 25;
      store.set({
        imageOffset: {
          x: Math.round(Math.min(lim, Math.max(-lim, o.x + dx)) * 10) / 10,
          y: Math.round(Math.min(lim, Math.max(-lim, o.y + dy)) * 10) / 10,
        },
      });
      debouncedRebuild();
    },
    onImageNudgeReset: () => {
      store.set({ imageOffset: { x: 0, y: 0 } });
      debouncedRebuild();
    },
    onSeparateLetters: (on) => {
      // Text only: re-trace the word so letters are either merged into one element (off)
      // or split into one selectable/colorable part per glyph (on). Clear the selection
      // since the part names change with the grouping.
      store.set({ separateLetters: on, selectedParts: [] });
      reprocess();
    },
    onUndo: () => undo(),
    onRedo: () => redo(),
    onRefresh: () => refreshDesign(),
    onStatus: (text) => store.set({ status: text }),
  }, store.get());

  modelMode = createModelMode({
    store,
    viewer,
    // `worker` is created further down; this only runs once it exists.
    post: (msg, transfer) => worker.postMessage(msg, transfer ?? []),
    // A result card's build: correlated like a batch run's, so the viewport never sees it.
    buildDetached: (params) => {
      const requestId = `m${++buildSeq}`;
      return new Promise((resolve) => {
        pendingBuilds.set(requestId, resolve);
        worker.postMessage({ type: 'buildModel', params, requestId });
      });
    },
    stage: container.querySelector<HTMLElement>('#viewport')!,
    rebuildSoon: (live) => (live ? debouncedQuietRebuild() : debouncedRebuild()),
    reframeNext: () => { pendingReframe = true; },
    resetHistoryNext: () => { pendingHistoryReset = true; },
    showColorPopoverAt: (x, y, hex, options, handlers) => ui.showColorPopoverAt(x, y, hex, options, handlers),
  });
  container.querySelector('#modelPanel')?.append(modelMode.panel.right);
  // Model mode's three left-rail categories (ui.ts declares their mounts).
  container.querySelector('#modelCutMount')?.append(modelMode.panel.parts.cut);
  container.querySelector('#modelBodyMount')?.append(modelMode.panel.parts.model);
  container.querySelector('#modelColoursMount')?.append(modelMode.panel.parts.colours);

  // ---- Undo / redo ----------------------------------------------------------
  // History snapshots the editable "document" fields (colors, heights, edges,
  // shape/size). Each tracked change pushes a snapshot; re-tracing a new source
  // (reprocess) starts a fresh baseline. Restoring rebuilds the geometry.
  const HISTORY_FIELDS = [
    'palette', 'paletteOverrides', 'partOverrides', 'customColors', 'bodyColorRgb', 'baseColorOverride',
    'componentHeights', 'edgeSettings', 'extrudeChamfer', 'baseShape', 'capWidthMm', 'topThickness',
    'imageDepth', 'capProud', 'hollowBase', 'fixedSize', 'designScale', 'shapeSides', 'shapeCornerPct',
    'shapeArmPct', 'tolerance',
    /* Which custom outline, as well as THAT it is custom.
       `baseShape` alone was never enough: restoring 'custom' without also restoring the token
       (or the drawn id) left the build with no rings, and `makeCustom` answers that with a
       circle. So undoing past a shape change quietly replaced a pumpkin with a disc, and the
       next save wrote the disc down. Both ids are short strings; the rings they point at stay
       out of the snapshot. */
    'packShapeToken', 'drawnShapeId',
    'stemFitMm',
    'socketFitPct',
    'switches', 'keychain',
    'modelCut',
    // Blocks: the look. What is ON the keys (layout, lines) re-traces, which starts a new
    // baseline the way typing does in Text mode, so it is not in here.
    'blockStyle', 'blockTexture', 'legendScale', 'legendBold',
  ] as const;
  let history: string[] = [];
  let histIndex = -1;
  let restoringHistory = false;
  let pendingHistoryReset = false;
  /** Set when the next build should re-frame the camera (new subject, not an edit). */
  let pendingReframe = true;
  /* Set right before a sample/pack image goes into the wizard, by NAME — `onSample` only ever
     hands this file a loader function, never a label, so this is how the eventual settled
     status ("Sample: X…") learns what got picked. Consumed by the next 'parts' message (or
     cleared on cancel), never left standing: otherwise an unrelated slider tweak two minutes
     later would inherit a stale sample name. */
  let pendingSampleLoadName: string | null = null;
  /* Set when switching TO icon mode silently swaps an Outline base for Circle
     (`buildParamsFor`'s `effectiveBaseShape`) — icons are line art, not a filled region, so an
     Outline base would trace to a broken ring. Surfaced once, on the build that switch
     produces, rather than on every rebuild after (which would repeat the same sentence for
     every unrelated edit made while still in icon mode). */
  let pendingIconBaseNote = false;

  function snapshotHistory(): string {
    const s = store.get() as any;
    const picked: Record<string, unknown> = {};
    for (const k of HISTORY_FIELDS) picked[k] = s[k];
    return JSON.stringify(picked);
  }
  function updateHistoryButtons() {
    store.set({ canUndo: histIndex > 0, canRedo: histIndex < history.length - 1, canRefresh: history.length > 1 });
  }
  function resetHistory() {
    history = [snapshotHistory()];
    histIndex = 0;
    updateHistoryButtons();
  }
  const commitHistory = debounce(() => {
    if (restoringHistory || pendingHistoryReset || histIndex < 0) return;
    const snap = snapshotHistory();
    if (snap === history[histIndex]) return;
    history = history.slice(0, histIndex + 1);
    history.push(snap);
    const MAX = 60;
    if (history.length > MAX) history = history.slice(history.length - MAX);
    histIndex = history.length - 1;
    updateHistoryButtons();
  }, 350);
  function applyHistorySnapshot(snap: string) {
    restoringHistory = true;
    store.set(JSON.parse(snap));
    /* Re-derive the pack rings from the token the snapshot just restored.
       `packShapeRings` is a single variable outside the store, so after switching between two
       pack shapes it holds the LATER one — and undo would have brought back the earlier one's
       name against the later one's outline. The directory is already loaded by the time any of
       this is reachable, so the lookup is free. */
    const restored = store.get();
    if (restored.packShapeToken) {
      const entry = findShape(restored.packShapeToken);
      if (entry?.rings?.length) packShapeRings = entry.rings;
    }
    restoringHistory = false;
    updateHistoryButtons();
    rebuild(); // regenerate geometry + colors for the restored state
  }
  function undo() {
    if (histIndex <= 0) return;
    histIndex--;
    applyHistorySnapshot(history[histIndex]);
  }
  function redo() {
    if (histIndex >= history.length - 1) return;
    histIndex++;
    applyHistorySnapshot(history[histIndex]);
  }
  function refreshDesign() {
    if (history.length > 1) {
      applyHistorySnapshot(history[0]);
      // The state now matches the original snapshot, but we want this to be an undoable action
      // so we call commitHistory right away to push the "refreshed" state as a new history step
      // (commitHistory is debounced, but that's fine).
      commitHistory();
    }
  }

  // Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z or Ctrl+Y = redo (ignored while typing).
  const onWindowKeydown = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null;
    const tag = el?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    // Undo would rebuild a design nobody can see; the history buttons are locked too.
    if (store.get().fitTestActive) return;
    const k = e.key.toLowerCase();
    if (k === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    } else if (k === 'y') {
      e.preventDefault();
      redo();
    }
  };
  window.addEventListener('keydown', onWindowKeydown);
  cleanups.push(() => window.removeEventListener('keydown', onWindowKeydown));

  store.subscribe((s) => {
    ui.update(s);
    modelMode.sync(s);

    // Highlight the current selection in every mode (hover is handled separately).
    const indices: number[] = [];
    s.selectedParts.forEach((name) => {
      const idx = latestParts.findIndex((p) => p.name === name);
      if (idx >= 0) indices.push(idx);
    });
    viewer.highlightParts(indices);

    // Record undoable edits (debounced; no-op if nothing tracked actually changed).
    if (!restoringHistory && !pendingHistoryReset) commitHistory();
  });
  ui.update(store.get());
  modelMode.sync(store.get());

  // Load Vostok Labs logo sample on startup
  SAMPLES[0].load().then((img) => {
    originalImage = img;
    if (assetsReady && !defaultClickerLoaded) {
      reprocess();
    }
  }).catch((err) => {
    console.error('Failed to load default image', err);
  });

  // ---- Click a colored region on the 3D model to recolor it (live, no rebuild) ----
  viewer.onPartPick((index, clientX, clientY, shiftKey) => {
    const s = store.get();
    // The meshes on screen are test tiles, and every index below means a part of the design.
    if (s.fitTestActive) return;

    // Model mode: a click recolours that piece. Its parts are named by role (button, base),
    // not by colour region, so the palette machinery below has nothing to map them to.
    if (s.importMode === 'model') {
      if (index !== null) modelMode.pickPart(latestParts[index], clientX, clientY);
      return;
    }

    // Empty space clears the selection (all modes).
    if (index === null) {
      store.set({ selectedParts: [] });
      return;
    }

    const partName = latestParts[index]?.name;
    if (!partName) return;

    if (s.editMode === 'color') {
      // Color mode: single target. Open the swatch picker for the clicked color and
      // recolor its whole group; clear the highlight on close so the true color shows.
      store.set({ selectedParts: [partName] });
      const part = latestParts[index];
      if (!part) return;
      const target = partColorTarget(part.name);
      if (!target) return;
      const offered: RGB[] =
        s.colorMode === 'limited' && s.limitedColors.length > 0
          ? s.limitedColors
          : FILAMENTS.map(([, hex]) => hexToRgb(hex));
      const sameRgb = (a: RGB, b: RGB) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
      const options: RGB[] = [
        ...s.customColors.filter((c) => !offered.some((o) => sameRgb(o, c))),
        ...offered,
      ];
      ui.showColorPopoverAt(clientX, clientY, rgbToHex(part.colorRgb), options, {
        onSelect: (hex) => applyModelRecolor(target, hexToRgb(hex), index),
        onClose: () => store.set({ selectedParts: [] }),
      });
      return;
    }

    // Extrude / edges: unified multi-selection — shift toggles a part in/out, a plain
    // click selects one. The floating panels act on every selected part.
    let nextSelected = s.selectedParts.slice();
    if (shiftKey) {
      nextSelected = nextSelected.includes(partName)
        ? nextSelected.filter((p) => p !== partName)
        : [...nextSelected, partName];
    } else {
      nextSelected = [partName];
    }
    store.set({ selectedParts: nextSelected });
  });

  function partColorTarget(name: string): ColorTarget | null {
    if (name === 'base-body') return { kind: 'body' };
    if (name === 'top-base') return { kind: 'base' };
    // Letter blocks: the left-hand palette sets a whole group (see onCapColor / onFilament),
    // while clicking in the viewport is the way to customise ONE cap or ONE letter. The
    // bodies are the exception — the blocks read as a single object, so any of them recolors
    // the lot.
    if (/^block-\d+$/.test(name)) return { kind: 'body' };
    if (/^cap-\d+$/.test(name)) return { kind: 'part', name };
    // A click in the viewport means THIS shape — one key, one letter, one island — in
    // every mode, not just blocks. Both the click and the palette row used to funnel
    // into the whole colour bucket, which left no way to recolour a single component.
    if (/^top-color-\d+-\d+$/.test(name)) return { kind: 'part', name };
    // Fallback for a region carrying no component index. The bucket-wide path is what
    // the left-hand palette rows use; they call applyModelRecolor directly.
    const m = /^top-color-(\d+)(?:-(\d+))?$/.exec(name);
    if (m) {
      return { kind: 'region', index: +m[1], compIndex: m[2] ? +m[2] : 0 };
    }
    return null;
  }

  // --- Edit Mode Event Hooks (Gizmo Drag Handlers Removed) ---

  // Apply a recolor to the clicked part: update the live material + export data, and
  // persist into store state so it survives rebuilds. Geometry is identical for a
  // color change, so we deliberately skip the worker rebuild.
  /* A colour picked from the wheel joins this design's palette.

     Ian: "if I add a new colour that is not in the image palette, add it to the colouring
     palette for that design so I can pick it for other elements as well." Without this the
     wheel produced a one-off: the second shape that wanted the same custom red meant finding
     it on the wheel again by eye. Shelf colours are already swatches, so only off-shelf ones
     are recorded, once each. */
  function rememberColour(rgb: RGB) {
    const same = (a: RGB, b: RGB) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
    if (FILAMENTS.some(([, hex]) => same(hexToRgb(hex), rgb))) return;
    const s = store.get();
    if (s.customColors.some((c) => same(c, rgb))) return;
    store.set({ customColors: [...s.customColors, rgb] });
  }

  function applyModelRecolor(target: ColorTarget, rgb: RGB, partIndex: number) {
    const s = store.get();
    if (target.kind === 'region') {
      // The whole colour bucket. Only the left-hand palette rows reach this — a click on
      // the model recolours the one shape it hit (see partColorTarget).
      const i = target.index;
      // A block chain has one legend part per block (top-color-0-0, top-color-1-0, …) and a
      // single "Letters" row governing the lot, so there the bucket is every legend.
      const blocks = s.importMode === 'blocks';
      const prefix = `top-color-${i}-`;
      const isTarget = blocks
        ? (n: string) => /^top-color-\d+-\d+$/.test(n)
        : (n: string) => n.startsWith(prefix);
      // The row governs its bucket, so it also RESETS the shapes in that bucket the user
      // recoloured one by one — otherwise the swatch would change and half the model
      // would not follow. The colour survives the next rebuild through `palette` /
      // `paletteOverrides` below, which is what the builder reads for a region's base.
      const overrides = s.partOverrides ? { ...s.partOverrides } : {};
      for (const k of Object.keys(overrides)) if (isTarget(k)) delete overrides[k];
      latestParts.forEach((p, idx) => {
        if (isTarget(p.name)) {
          viewer.setPartColor(idx, rgb);
          latestParts[idx] = { ...latestParts[idx], colorRgb: rgb };
        }
      });
      const palette = s.palette.slice();
      if (palette[i]) palette[i] = { ...palette[i], filamentRgb: rgb };
      const paletteOverrides = s.paletteOverrides.slice();
      paletteOverrides[i] = rgb;
      store.set({ partOverrides: overrides, palette, paletteOverrides });
      syncBaseColor(); // the cap frame mirrors the dominant region, keep it in step
    } else if (target.kind === 'part') {
      // One part only. Recorded in partOverrides so it survives the next rebuild.
      viewer.setPartColor(partIndex, rgb);
      if (latestParts[partIndex]) latestParts[partIndex] = { ...latestParts[partIndex], colorRgb: rgb };
      store.set({ partOverrides: { ...(s.partOverrides ?? {}), [target.name]: rgb } });
    } else {
      // Body / cap colours are model-wide. A block chain has one mesh per block and one per
      // cap, so repaint every member of the group — not just the one that was clicked.
      const isMember =
        target.kind === 'body'
          ? (n: string) => n === 'base-body' || /^block-\d+$/.test(n)
          : (n: string) => n === 'top-base' || /^cap-\d+$/.test(n);
      latestParts.forEach((p, i) => {
        if (i === partIndex || isMember(p.name)) {
          latestParts[i] = { ...latestParts[i], colorRgb: rgb };
          viewer.setPartColor(i, rgb);
        }
      });
      store.set(target.kind === 'body' ? { bodyColorRgb: rgb } : { baseColorOverride: rgb });
    }
  }

  // ---- Cap frame / backing color ----
  const LIGHT_FRAME: RGB = [240, 240, 240];
  const DARK_FRAME: RGB = [38, 38, 42];

  function relLuminance(rgb: RGB): number {
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  }
  // A light or dark backing chosen to contrast the given ink, so a single-color design
  // is always visible against it.
  function contrastingFrame(ink: RGB): RGB {
    return relLuminance(ink) > 150 ? DARK_FRAME : LIGHT_FRAME;
  }

  function dominantInk(s: UiState): RGB {
    if (s.palette.length === 0) return [180, 180, 185];
    let domIdx = 0;
    for (let i = 1; i < s.palette.length; i++) {
      if (s.palette[i].coverage > s.palette[domIdx].coverage) domIdx = i;
    }
    return s.palette[domIdx]?.filamentRgb ?? [180, 180, 185];
  }

  // The cap backing/frame color. A photographic IMAGE tiles the whole cap, so the frame
  // mirrors its dominant region and blends in naturally. Line-art modes (icon/svg/text)
  // are typically a single ink — mirroring that ink would make the design vanish into
  // its own backing (the "svg comes out one color" bug), so we pick a contrasting frame
  // instead. The design then reads clearly without any manual recolor.
  function deriveFrameColor(s: UiState): RGB {
    // Blocks: the keycap is its own filament the user picks, not a backing derived from the
    // artwork — deriving it would flip the caps light/dark every time the legend changed.
    if (s.importMode === 'blocks') return s.baseColorOverride ?? LIGHT_FRAME;
    const ink = dominantInk(s);
    return s.importMode === 'image' ? ink : contrastingFrame(ink);
  }

  // After a region recolor, repaint the frame part to match the derived color — live, no
  // rebuild — so it never lags a frame behind the inlay it shares a color with.
  function syncBaseColor() {
    const s = store.get();
    // Blocks keep an independent cap colour — never mirror the legend into it.
    if (s.importMode === 'blocks') return;
    if (s.baseColorOverride || s.palette.length === 0) return;
    const baseRgb = deriveFrameColor(s);
    latestParts.forEach((p, i) => {
      // 'top-base' is the single clicker cap; 'cap-N' are the keycaps of a block chain.
      if (p.name === 'top-base' || /^cap-\d+$/.test(p.name)) {
        latestParts[i] = { ...latestParts[i], colorRgb: baseRgb };
        viewer.setPartColor(i, baseRgb);
      }
    });
  }

  // Seed the SVG panel with bundled vector presets (added quietly, not selected).
  (async function loadSvgSamples() {
    for (const sample of SVG_SAMPLES) {
      try {
        const svgText = await fetch(sample.src).then((r) => r.text());
        ui.addUploadedSvg(svgText, sample.name, false);
      } catch (err) {
        console.warn('Could not load SVG sample', sample.name, err);
      }
    }
  })();

  // ---- Geometry worker ----
  const worker = new Worker(new URL('./workers/geometry.worker.ts', import.meta.url), {
    type: 'module',
  });
  cleanups.push(() => worker.terminate());

  /* One-off builds, correlated by request id.
     The live preview only ever has one build in flight and takes whatever comes back, which
     is why the worker never needed this. A batch run does: it drives N builds through the
     same worker and has to tell the answers apart. The map lives here rather than in the run
     loop so the worker protocol stays the shell's business and the paid module only ever
     awaits a promise. */
  const pendingBuilds = new Map<string, (r: { parts: ClickerPart[]; warnings: string[] }) => void>();
  let buildSeq = 0;
  function buildOne(
    regions: BuildRegion[],
    outline: Ring[],
    params: BuildParams,
  ): Promise<{ parts: ClickerPart[]; warnings: string[] }> {
    const requestId = `b${++buildSeq}`;
    return new Promise((resolve) => {
      pendingBuilds.set(requestId, resolve);
      worker.postMessage({ type: 'buildClicker', regions, outline, params, requestId });
    });
  }

  /* ---- Stem fit test --------------------------------------------------------------------
     A strip of test tiles shown in the preview in place of the design, and sent by the normal
     Export button, the way the keycap generator's fit test works. It used to download a 3MF
     the moment it was pressed, which inside MakerLab did nothing: the sandbox has no
     downloads. Going through Export also gives it the MakerLab route, the cover and the
     licence nudge the design gets.

     The design is never touched. `latestParts` keeps it, the UI locks the controls that shape
     it, and going back repaints it (rebuilding first if the stem fit changed meanwhile). */
  let fitStripParts: ClickerPart[] = [];
  let fitStripSeq = 0;
  /** The stem fit changed while the tiles were showing, so the design has not been built with it. */
  let designStale = false;
  /** The switch placements the last design build reported, to put back with the design. */
  let latestSwitchPlacements: SwitchPlacement[] = store.get().switches;
  /** What the status line said about the design before the fit test replaced it. */
  let statusBeforeFitTest = '';

  function showFitStrip() {
    const st = store.get();
    if (!st.fitTestActive) return;
    // Five tiles centred on the stepper, so after a first print a finer step tunes around the
    // tile that fitted. The number is debossed on each, in the same form the stepper shows.
    const values = fitTestLadder(st.stemFitMm, st.fitTestStepMm);
    let labels: { fitMm: number; rings: Ring[] }[];
    try {
      labels = values.map((fitMm) => {
        const rs = parseLetter(fitTestLabel(fitMm), FIT_TEST_FONT_ID, 6, false);
        return { fitMm, rings: rs.regions.flatMap((r) => r.components.flatMap((c) => c.rings)) };
      });
    } catch {
      // A label that will not render is not a reason to withhold the test.
      labels = values.map((fitMm) => ({ fitMm, rings: [] }));
    }
    const requestId = `fit${++fitStripSeq}`;
    store.set({ building: true, status: 'Building the fit test…' });
    pendingBuilds.set(requestId, ({ parts, warnings }) => {
      // A newer strip was asked for, or the preview already went back to the design.
      if (requestId !== `fit${fitStripSeq}` || !store.get().fitTestActive) return;
      fitStripParts = parts;
      viewer.setParts(parts, false);
      viewer.setView(store.get().view);
      store.set({
        building: false,
        hasParts: parts.length > 0,
        status: [
          ...warnings,
          `Fit test tiles ${values.map(fitTestLabel).join(', ')} mm. Export and print them, press each onto a switch, then set Switch stem fit to the number on the tile that fits.`,
        ].join(' · '),
      });
    });
    worker.postMessage({
      type: 'buildFitStrip',
      labels,
      // The same colour the real cap gets, so the tiles print in what they are looking at.
      colorRgb: st.baseColorOverride ?? deriveFrameColor(st),
      requestId,
    });
  }
  const debouncedFitStrip = debounce(showFitStrip, 130);

  function enterFitTest() {
    const st = store.get();
    if (st.fitTestActive) return;
    if (!assetsReady) {
      store.set({ status: 'Waiting for switch assets…' });
      return;
    }
    designStale = false;
    statusBeforeFitTest = st.status;
    store.set({ fitTestActive: true, selectedParts: [] });
    viewer.clearHighlight();
    // Pieces lie flat on the plate like the keycap's, so there is nothing for a switch to sit in.
    viewer.showSwitch(false);
    showFitStrip();
  }

  function exitFitTest() {
    if (!store.get().fitTestActive) return;
    fitStripSeq++; // a strip still in flight is no longer wanted
    fitStripParts = [];
    store.set({
      fitTestActive: false,
      building: false,
      hasParts: latestParts.length > 0,
      status: statusBeforeFitTest,
    });
    viewer.setParts(latestParts, false);
    viewer.setView(store.get().view);
    viewer.setSwitchPlacements(latestSwitchPlacements);
    viewer.showSwitch(store.get().showSwitch);
    if (designStale) {
      designStale = false;
      rebuild();
    }
  }

  worker.onmessage = (e: MessageEvent<GeometryResponse>) => {
    const msg = e.data;
    switch (msg.type) {
      case 'ready':
        initAssets();
        break;
      case 'initDone':
        assetsReady = true;
        switchColumnMm = msg.switchColumnMm;
        console.log('[assets] socket:', msg.socketInfo, '| stem:', msg.stemInfo, '| switch:', msg.switchInfo);
        viewer.setSwitch(msg.switchMesh);
        viewer.showSwitch(store.get().showSwitch);
        store.set({
          status: 'Ready. Import an image, SVG, icon, or text.',
        });
        // Pick a default popular icon on startup so it builds immediately
        if (store.get().importMode === 'icon' && !currentIconText) {
          const first = LUCIDE_ICONS.find((ic) => ic.name === 'circle') || LUCIDE_ICONS[0];
          if (first) {
            currentIconText = buildSvg(first.node);
            currentIconName = first.name;
            store.set({ currentIconName: first.name });
          }
        }
        if (isInitialLoad) {
          loadDefaultClicker();
        } else {
          reprocess();
        }
        break;
      case 'parts': {
        // A correlated build belongs to whoever asked for it, not to the viewport. Handled
        // before anything else here so a run in progress cannot repaint the preview forty
        // times or reset the undo baseline on every row.
        if (msg.requestId) {
          const resolve = pendingBuilds.get(msg.requestId);
          pendingBuilds.delete(msg.requestId);
          resolve?.({ parts: msg.parts, warnings: msg.warnings ?? [] });
          break;
        }
        latestParts = msg.parts;
        latestSwitchPlacements = msg.switchPlacements ?? [];
        if (msg.modelMeta) modelMode.onParts(msg.modelMeta, msg.warnings ?? []);
        // A design build that was already in flight when the fit test opened. It is still the
        // design, so keep it for when the preview goes back, but leave the tiles on screen.
        const showingFitTest = store.get().fitTestActive;
        if (!showingFitTest) {
          // Re-frame the camera only when the SUBJECT changed (a new image, icon, SVG, or a
          // different import mode). Editing what is already on screen — the text, the font,
          // the legend size — must leave the view exactly where the user put it.
          viewer.setParts(msg.parts, !pendingReframe);
          pendingReframe = false;
          viewer.setView(store.get().view);
          // Seat one preview switch per (clamped) placement the geometry was built around.
          viewer.setSwitchPlacements(latestSwitchPlacements);
        }

        // Extrude heights are baked into the geometry now — do NOT translate the
        // meshes too, or the raised part would float a second step above the model.
        // (Selection highlight is re-applied by the store subscription below.)

        // What the build had to say, plus what the PLATE has to say. The second half is new:
        // the layout has always known that a six-letter block chain does not fit an A1 bed and
        // never mentioned it, so the file arrived with pieces off the plate and the slicer was
        // the one to break the news. Same status line, because to the user it is the same
        // question — is this going to print.
        const notes = [...(msg.warnings ?? []), ...plateWarnings(msg.parts)].map((n) =>
          // The base-widened note has no next step of its own — "Lock the base size" exists
          // and fixes it, but nothing points there. Only when the lock is off: once it's on,
          // the size IS pinned, so the suggestion would be telling someone to do what they
          // just did.
          n === 'Base widened so the switch fits.' && store.get().fixedSize === null
            ? `${n} Try "Lock the base size" to set an exact size instead.`
            : n,
        );
        // Icons need a solid base; an Outline one just got swapped for Circle (see
        // `pendingIconBaseNote`'s declaration). Say so once, on this build, then forget it —
        // an unrelated edit five minutes later must not repeat a decision that already happened.
        if (pendingIconBaseNote) {
          notes.unshift('Icons need a solid base, so the shape switched to Circle.');
          pendingIconBaseNote = false;
        }
        // The size the build actually produced. It feeds "Lock the base size", which seeds
        // itself from it so turning the lock on never moves the model — and it is the answer
        // to "how big is this really", which the app has never been able to give.
        const bodyBB = groupBBox(msg.parts, 'base', assemblyMinZ(msg.parts));
        store.set({
          building: false,
          builtBodyMm: isFinite(bodyBB.minX)
            ? { w: bodyBB.maxX - bodyBB.minX, h: bodyBB.maxY - bodyBB.minY }
            : null,
          hasParts: msg.parts.length > 0,
          // Surface every non-fatal build note (switches pinched, base widened for the switch,
          // no keychain room) or clear. `warnings[0]` dropped the rest on the floor, which
          // matters now that a single build can raise two of them at once — the base was
          // widened AND the patch reached the printed face are different sentences with
          // different fixes, and the second one is the one people photograph. Joined with a
          // real separator rather than a bare space, so two sentences don't run together
          // ("fits.Increase" read as one malformed word).
          //
          // A clean build (no notes) still needs to say SOMETHING when it just loaded a named
          // sample or pack design — otherwise the status goes blank and the finished model on
          // screen reads as the user's own work, not a demo (audit #2). `pendingSampleLoadName`
          // is null for every ordinary edit, so this never fires outside that one moment.
          // A clean Model-mode build says what it made and that the switch fits it.
          status: showingFitTest
            ? store.get().status
            : notes.length
            ? notes.join(' · ')
            : msg.modelMeta
              ? modelMode.cleanStatus(msg.modelMeta)
              : pendingSampleLoadName
                ? `Sample: ${pendingSampleLoadName}. Drop your own image to replace it.`
                : '',
          // Only when THIS build is the one a sample/pack pick produced — spread in rather
          // than always naming the key, so an ordinary edit's `store.set` leaves whatever was
          // marked before untouched instead of clearing it every rebuild (audit #2).
          ...(pendingSampleLoadName ? { loadedSampleId: pendingSampleLoadName } : {}),
        });
        pendingSampleLoadName = null;
        isInitialLoad = false;

        // After a re-trace, the first build becomes the new undo baseline.
        if (pendingHistoryReset) {
          pendingHistoryReset = false;
          resetHistory();
        }
        break;
      }
      case 'modelInfo':
        modelMode.onModelInfo(msg.info);
        break;
      case 'error':
        // A model that failed to open is the user's file, not a crash: the controller says so
        // in words and forgets it.
        if (modelMode.onError(msg.message)) {
          console.error('[geometry worker]', msg.message);
          break;
        }
        store.set({ building: false, status: 'Error: ' + firstLine(msg.message) });
        console.error('[geometry worker]', msg.message);
        isInitialLoad = false;
        // A failed build answers neither pending flag — don't let either haunt the next
        // successful one.
        pendingSampleLoadName = null;
        pendingIconBaseNote = false;
        break;
    }
  };
  worker.onerror = (e) => {
    store.set({ building: false, status: 'Worker failed: ' + e.message });
    console.error(e);
  };

  async function initAssets() {
    try {
      const [socket, stem, sw, keycapJson] = await assetsPromise;
      worker.postMessage(
        { type: 'init', socket, stem, switch: sw, keycapJson },
        [socket, stem, sw],
      );
    } catch (err) {
      store.set({ status: 'Failed to load switch assets: ' + String(err) });
      isInitialLoad = false;
    }
  }

  async function loadDefaultClicker() {
    try {
      store.set({ status: 'Loading default clicker…' });
      const response = await fetch(base + 'assets/default-clicker.json');
      if (!response.ok) throw new Error('Failed to fetch default clicker asset');
      const serializedParts = await response.json();
      const parts: ClickerPart[] = serializedParts.map((p: any) => ({
        kind: p.kind,
        group: p.group,
        colorRgb: p.colorRgb,
        name: p.name,
        numProp: p.numProp,
        vertProperties: new Float32Array(p.vertProperties),
        triVerts: new Uint32Array(p.triVerts),
      }));
      latestParts = parts;
      viewer.setParts(parts, false);
      viewer.setView(store.get().view);
      store.set({
        building: false,
        hasParts: parts.length > 0,
        // The pre-built JSON skips the wizard entirely, so this is the ONLY signal that what
        // just appeared is a demo and not a blank project someone forgot to start (audit #2) —
        // an empty status here reads as "the app finished your work", which it did not.
        status: `Sample: ${SAMPLES[0].name} logo. Drop your own image to replace it.`,
        // Same reason, for the sample grid's own mark rather than the status line: the pre-built
        // JSON never goes through the 'parts' handler above (the one place that normally sets
        // this from `pendingSampleLoadName`), so nothing else will ever mark this tile.
        loadedSampleId: SAMPLES[0].name,
      });
      defaultClickerLoaded = true;
      isInitialLoad = false;
      /* The undo baseline. Every other way a model appears goes through `reprocess()`, which
         flags a reset that the next 'parts' message performs; this fast path never sends one,
         so `histIndex` stayed at -1 and `commitHistory` refused every snapshot. Undo, redo and
         refresh were dead on the clicker most people start from. */
      resetHistory();
    } catch (err) {
      console.warn('Failed to load pre-built default clicker, falling back to dynamic build:', err);
      if (originalImage) {
        // Same sample, the slow path — carry the same honesty through to whatever this
        // build settles on (see `pendingSampleLoadName`'s declaration).
        pendingSampleLoadName = SAMPLES[0].name;
        reprocess();
      }
    }
  }

  // ---- Pipeline ----
  async function openWizard(getter: () => Promise<RgbaImage>) {
    /* Two try blocks, because two different things can fail and the user needs to be told
       which. Decoding the file is the one the friendly "try a PNG" line is about. Everything
       after it — opening the wizard, the store update it triggers, the sidebar repaint — is
       app code, and when THAT throws the same line is a lie: a sample from the bundled
       gallery is a PNG. One catch round both hid a UI error behind advice about file types. */
    let baseImage: RgbaImage;
    pendingReframe = true; // a new picture is a new subject, so frame it
    // Outside the decode try on purpose: a store update repaints the sidebar, and a fault
    // there must not be reported as a bad file.
    store.set({ building: true, status: 'Reading image…' });
    try {
      baseImage = await getter();
    } catch (err) {
      // The raw error (an `EncodingError:` or similar browser-internal message) told the user
      // nothing they could act on — the real cause console.warn keeps for us, this line
      // states in a way that names the actual fix.
      console.warn('[image decode]', err);
      store.set({ building: false, status: "Couldn't read that image. Try a PNG or JPG." });
      return;
    }
    try {
      store.set({ building: false, status: 'Preprocess your image…' });
      const reopening = baseImage === wizardBase;
      const s = store.get();
      runWizard({
        baseImage,
        initialColorCount: s.colorCount,
        initialSmoothing: s.smoothing,
        initialRemoveBg: s.removeBg,
        initialPreprocess: reopening && wizardParams ? wizardParams : undefined,
        initialLimitedColors: reopening && s.colorMode === 'limited' ? s.limitedColors : undefined,
        designMm: s.capWidthMm * (s.designScale ?? 1),
        onCancel: () => {
          // Cancelling never reaches the build that would have consumed this — clear it here
          // or the NEXT unrelated build (a slider nudge, say) would wrongly claim to be the
          // sample that was just backed out of.
          pendingSampleLoadName = null;
          store.set({ status: originalImage ? 'Ready.' : 'Ready. Drop an image or try the sample.' });
        },
        onComplete: ({ adjusted, preprocess, colorCount, smoothing, colorMode, limitedColors, paletteOverrides }) => {
          originalImage = adjusted;
          wizardBase = baseImage;
          wizardParams = preprocess;
          /* The body colour is NOT touched here any more. The wizard now always confirms a
             kept-colour list (`limited`), and the old rule for that mode — body becomes the
             list's black, else its first colour — would have repainted the base after every
             confirm with whatever the picture's biggest colour happened to be. */
          store.set({
            removeBg: !preprocess.keepBackground,
            colorCount,
            smoothing,
            // Image Thickness was dropped from the wizard — it's a geometry setting, not an
            // image one, and it already lives in the sidebar. Writing it here on every
            // confirm meant this dialog silently clobbered whatever the sidebar had just
            // been set to.
            colorMode,
            limitedColors: limitedColors || [],
            paletteOverrides: paletteOverrides || [],
            /* And the per-shape recolors, which nothing else clears.
               A part is named by position — `top-color-<region>-<component>` — so an
               override recorded on one picture lands on whatever occupies that slot in
               the next one. Recolor a black outline yellow, import a different image,
               and its region 0 comes back yellow with no palette row saying so. */
            partOverrides: {},
          });
          reprocess();
        },
      });
    } catch (err) {
      console.error('[image wizard]', err);
      store.set({ building: false, status: 'Could not open the image tools: ' + String(err) });
    }
  }

  /**
   * Open the shape editor (private) on the current base shape, and
   * apply its result: a preset's knobs, a library shape's token, or drawn rings kept by id in
   * `drawnRings` and named in the state by `drawnShapeId`.
   */
  async function openShapeEditorForState(): Promise<void> {
    // False in any build without the editor (see vite.config.ts); the picker omits its button
    // there too, so this is the second lock.
    if (!__SHAPE_EDITOR__) return;
    /* Checked for access in the MakerWorld build. `MAKERLAB &&` is load-bearing: in dev and
       internal builds `virtual:makerlab` is the stub, whose checks all answer false. */
    if (MAKERLAB && !(await (proPanel?.gateShape() ?? ensureAccess(SELLER_PACK)))) return;
    /* The editor is the app's ONE lazily loaded chunk, so it is the one thing that can fail to
       arrive after the page has loaded: a tab left open across a deploy asks for a chunk file
       whose hash no longer exists on the server. The picker had already closed and this call
       is fired with `void`, so the rejection went nowhere and the button simply did nothing.
       Ian, 2026-09-07, after two rebuilds under his open preview tab: "I just pressed draw your
       own shape and it just silently fails". Say so, and say what fixes it. */
    let editor: typeof import('virtual:shape-editor');
    try {
      editor = await import('virtual:shape-editor');
    } catch (err) {
      console.error('[shape editor] failed to load', err);
      toast('Could not load the shape editor. Reload the page and try again.');
      return;
    }
    const { openShapeEditor } = editor;
    const s = store.get();
    const current = ringsForState(s);
    // The base's longest side, in the millimetres the editor measures everything against. The
    // measured body is the honest number once there is one; `capWidthMm` is what the Size
    // slider says, which is the right answer before the first build.
    const spanMm = s.builtBodyMm
      ? Math.max(s.builtBodyMm.w, s.builtBodyMm.h)
      : s.capWidthMm;
    const result = await openShapeEditor({
      shapes: allShapes(),
      current: {
        baseShape: s.baseShape,
        packShapeToken: s.packShapeToken,
        shapeSides: s.shapeSides,
        shapeCornerPct: s.shapeCornerPct,
        shapeArmPct: s.shapeArmPct,
        fixedSize: s.fixedSize,
        rings: current,
      },
      spanMm,
      switchColumnMm,
      switches: s.switches.map((sw) => ({ x: sw.x, y: sw.y })),
    });
    if (!result) return;

    if (result.kind === 'preset') {
      store.set({
        baseShape: result.baseShape,
        packShapeToken: null,
        drawnShapeId: null,
        shapeSides: result.shapeSides,
        shapeCornerPct: result.shapeCornerPct,
        shapeArmPct: result.shapeArmPct,
        fixedSize: result.fixedSize,
      });
    } else if (result.packShapeToken) {
      // A library shape the editor did not change. Stored as its TOKEN, exactly as picking it
      // from the old drawer did — so the button still names it, and the project file holds a
      // few bytes rather than a few hundred points that the directory can re-derive anyway.
      const entry = findShape(result.packShapeToken);
      if (entry?.rings?.length) packShapeRings = entry.rings;
      store.set({
        baseShape: 'custom',
        packShapeToken: result.packShapeToken,
        drawnShapeId: null,
        fixedSize: result.fixedSize,
      });
    } else {
      store.set({
        baseShape: 'custom',
        packShapeToken: null,
        drawnShapeId: rememberDrawing(result.rings),
        fixedSize: result.fixedSize,
      });
    }
    debouncedRebuild();
  }

  function reprocess() {
    // Model mode has no picture to trace: arriving in it means building the model (or opening
    // on a sample when nothing has been uploaded yet), as a new undo baseline.
    if (store.get().importMode === 'model') {
      pendingHistoryReset = true;
      modelMode.enter();
      return;
    }
    // A fresh trace means fresh regions, so start a new undo baseline and drop any
    // pinned frame color so it re-derives. Blocks are the exception: their three colours
    // (bodies / caps / legends) are chosen deliberately and must survive editing the chain
    // — otherwise adding a symbol repaints the caps out from under you.
    pendingHistoryReset = true;
    if (store.get().importMode !== 'blocks') store.set({ baseColorOverride: null });
    const s = store.get();

    if (s.importMode === 'image') {
      if (!originalImage) return;
      store.set({ building: true, status: 'Removing background & tracing…' });
      regionSet = processImage(cloneImage(originalImage), s.colorCount, {
        removeBg: s.removeBg,
        smoothing: s.smoothing,
        // The artwork's printed size, so the tracer's minimum feature is a real millimetre
        // rather than a fraction of whatever the uploaded file's pixel dimensions happened
        // to be. A bigger cap keeps finer detail, which is what it should do.
        designMm: s.capWidthMm * (s.designScale ?? 1),
        customColors: s.colorMode === 'limited' ? s.limitedColors : undefined,
      });
    } else if (s.importMode === 'svg') {
      if (!currentSvgText) {
        store.set({ status: 'Upload an SVG file first.' });
        return;
      }
      try {
        store.set({ building: true, status: 'Parsing SVG…' });
        // `removeBg` is a live control, so it wins over whatever the preview was opened with.
        regionSet = parseSvg(currentSvgText, { ...currentSvgOptions, removeBg: s.removeBg });
      } catch (e: any) {
        store.set({ building: false, status: 'Error: ' + e.message });
        return;
      }
    } else if (s.importMode === 'icon') {
      if (!currentIconText) {
        const first = LUCIDE_ICONS.find((ic) => ic.name === 'circle') || LUCIDE_ICONS[0];
        if (first) {
          currentIconText = buildSvg(first.node);
          currentIconName = first.name;
          store.set({ currentIconName: first.name });
        }
      }
      if (!currentIconText) {
        store.set({ status: 'Select an icon first.' });
        return;
      }
      try {
        store.set({ building: true, status: 'Parsing icon…' });
        regionSet = parseSvg(currentIconText);
      } catch (e: any) {
        store.set({ building: false, status: 'Error: ' + e.message });
        return;
      }
    } else if (s.importMode === 'blocks') {
      try {
        store.set({ building: true, status: 'Generating blocks…' });
        const arr = arrangeBlocks(s.blockLayout, s.blockGridRows, s.blockGridCols, s.blockCells, s.blockLines, s.blockSymbols);
        regionSet = parseBlockChain(arr.slots, currentFontId, tracedSymbols(s.blockSymbols));
      } catch (e: any) {
        store.set({ building: false, status: 'Error: ' + e.message });
        return;
      }
    } else if (s.importMode === 'text') {
      try {
        store.set({ building: true, status: 'Generating text…' });
        regionSet = parseLetter(currentText, currentFontId, 15, s.separateLetters, {
          lineSpacing: s.lineSpacing,
          letterSpacing: s.letterSpacing,
        }, lineSymbols(s.textSymbols));
        store.set({ textSizeMul: regionSet.sizeMul ?? 1 });
      } catch (e: any) {
        store.set({ building: false, status: 'Error: ' + e.message });
        return;
      }
    }

    if (!regionSet) return;

    // Blocks print in three filaments (blocks / caps / legends), so every letter shares one
    // palette entry instead of getting a swatch of its own.
    const palette: PaletteEntry[] =
      s.importMode === 'blocks'
        ? [
            {
              quantRgb: regionSet.regions[0]?.quantRgb ?? ([247, 247, 245] as RGB),
              filamentRgb: s.paletteOverrides[0] ?? regionSet.regions[0]?.quantRgb ?? ([247, 247, 245] as RGB),
              coverage: 1,
            },
          ]
        : regionSet.regions.map((r, i) => ({
            quantRgb: r.quantRgb,
            filamentRgb: s.paletteOverrides[i] ?? r.quantRgb,
            coverage: r.coverage,
          }));
    store.set({ palette });

    if (palette.length === 0) {
      // A dead end on its own — anyone who skips the wizard (icon, SVG, text all can reach
      // this) needs the next step spelled out, not just the diagnosis.
      store.set({
        building: false,
        status: 'No outline found. Turn off Remove background, or use Adjust image to check the trace.',
      });
      return;
    }
    rebuild();
  }


  /**
   * Every `BuildParams` field, derived from app state and nothing else.
   *
   * Lifted out of `rebuild()` so a batch run can ask for "the settings the user has right
   * now" without going near the live preview: the run loop takes these, overrides the row's
   * text and colour, and builds N of them. Inlined, the run would have had to re-derive the
   * two dozen fields below and they would have drifted apart the first time one changed.
   */
  function buildParamsFor(s: UiState): BuildParams {
    // Icons are line-art (a single-color silhouette), not a multi-color picture.
    // Using their thin stroke as the body outline makes a broken ring, so the body
    // is always a solid shape (circle/square) and the icon rides on top as a design.
    const isIcon = s.importMode === 'icon';
    const effectiveBaseShape = isIcon && s.baseShape === 'outline' ? 'circle' : s.baseShape;
    // The cap backing contrasts line-art designs so they stay visible (see
    // deriveFrameColor). A frame the user pinned by clicking the model wins over it.
    const capBaseColor: RGB = s.baseColorOverride ?? deriveFrameColor(s);
    const isText = s.importMode === 'text' || s.importMode === 'blocks';
    const isTextMode = s.importMode === 'text';
    const textScale = s.textScale ?? 1;
    const textOutline = effectiveBaseShape === 'outline';
    return {
      baseShape: effectiveBaseShape,
      /* Text mode sizing. Two multipliers on the Size the user set, and both exist so the
         LETTERS never shrink to accommodate something else:
           · textSizeMul — spacing widened the word, so the part grows to match.
           · textScale   — the Text size slider itself. On an outline base the letters ARE
             the shape, so growing them grows the clicker. On a preset base there is a frame
             to shrink into, so below 100% the letters shrink inside a base that stays put
             (that is `designScale`), and above 100% the base grows with them. */
      capWidthMm: isTextMode
        ? s.capWidthMm * (s.textSizeMul ?? 1)
          * (textOutline ? textScale : Math.max(1, textScale))
        : s.capWidthMm,
      topThickness: Math.max(1, s.topThickness),
      imageDepth: s.imageDepth,
      imageMargin: isText ? 2.5 : 1.2,
      borderWidth: isText ? 3.5 : 2.6,
      capProud: s.capProud,
      hollowBase: s.hollowBase,
      // Null, not `{w:0,h:0}` — buildClicker treats any absent/degenerate size as "follow the
      // design", and the whole point of the control is that it is off until asked for.
      bodySize: s.fixedSize ?? undefined,
      designScale: isTextMode && !textOutline ? Math.min(1, textScale) : s.designScale,
      shapeSides: s.shapeSides,
      shapeCornerPct: s.shapeCornerPct,
      shapeArmPct: s.shapeArmPct,
      // Only meaningful for `baseShape: 'custom'`; buildClicker falls back to a circle if it
      // is missing, which is what a pack file that failed to load would otherwise print as.
      baseShapeRings: effectiveBaseShape === 'custom'
        ? ringsForState(s) ?? undefined
        : undefined,
      tolerance: s.tolerance,
      stemFitMm: s.stemFitMm,
      socketFitPct: s.socketFitPct,
      imageOffset: s.imageOffset,
      colorBleed: 0.12,
      stepHeight: 0.6,
      travel: 4.0,
      floorThickness: 1.6,
      switches: s.switches,
      keychain: s.keychain,
      baseFilamentRgb: capBaseColor,
      bodyColorRgb: s.bodyColorRgb ?? ([120, 124, 130] as RGB),
      edgeSettings: s.edgeSettings,
      extrudeChamfer: s.extrudeChamfer,
      componentHeights: s.componentHeights,
      ...blockBuildParams(s),
      legendScale: s.legendScale,
      legendBold: s.legendBold,
      textBold: s.importMode === 'text' ? s.textBold : 0,
      keychainEnd: s.keychainEnd,
      keychainSlideMm: s.keychainSlideMm,
      partOverrides: s.partOverrides,
      // Paid geometry, merged last so a free field can never silently override it. `{}` in
      // the public build, where the module is an inline stub.
      ...(proPanel?.paramsPatch() ?? {}),
    };
  }

  function rebuild(quiet = false) {
    // Asking for a design build means wanting to see the design. The controls that could ask
    // are locked while the fit test is showing; this catches the paths that are not controls
    // (a file dropped on the window, a project opened). Cleared first, so going back does not
    // queue a second build of its own.
    if (store.get().fitTestActive) {
      designStale = false;
      exitFitTest();
    }
    // Nothing to build yet, and SAYING so is the whole point of this branch.
    //
    // Every control in the sidebar is live from the moment the app opens, and every one of
    // them ends up here: Size, Top thickness, Image depth, the base shape, the edges, the
    // keychain, the switch pad. With no image loaded this used to be a bare `return`, so
    // the slider moved, the number changed, and the model did not — silently, with no hint
    // that the app was waiting on something. That is indistinguishable from a broken
    // slider, and it is what one was reported as.
    //
    // The guard below has always explained itself. This one now does too.
    // …and the previous version of that comment was written about a slider that did nothing
    // while the app was genuinely empty. This one is about the case it did not cover: the app
    // is NOT empty. On startup the prebuilt `default-clicker.json` is painted straight into the
    // viewer for a fast first frame, and `defaultClickerLoaded` then suppresses the trace of the
    // sample image that would have filled `regionSet`. So every control in that list arrived
    // here, printed "nothing to build yet", and did nothing — with a finished clicker on screen
    // and a sample image already decoded in memory.
    //
    // Recovering needed the user to click an import tab (even the one already selected), which
    // nobody would guess. It is the best explanation on offer for the "nothing is loading" /
    // "the generator is not working" / "there's no customize" reports on both listings.
    //
    // Tracing lazily rather than at startup keeps the fast first paint: the cost is paid once,
    // on the first control the user actually touches. `reprocess()` fills `regionSet` and calls
    // `rebuild()` itself, so this returns rather than falling through.
    if (store.get().importMode === 'model') {
      if (!assetsReady) {
        store.set({ status: 'Waiting for switch assets…' });
        return;
      }
      modelMode.build(quiet);
      return;
    }
    if (!regionSet && originalImage && store.get().importMode === 'image') {
      reprocess();
      return;
    }
    if (!regionSet || regionSet.regions.length === 0) {
      store.set({
        building: false,
        status: 'Nothing to build yet: choose an image, SVG, icon or text at the top first.',
      });
      return;
    }
    if (!assetsReady) {
      store.set({ status: 'Waiting for switch assets…' });
      return;
    }
    const s = store.get();

    const blocksMode = s.importMode === 'blocks';
    const regions: BuildRegion[] = [];
    regionSet.regions.forEach((r, i) => {
      // Every legend in a block chain shares palette slot 0 (one filament for all letters).
      const baseColor = (blocksMode ? s.palette[0] : s.palette[i])?.filamentRgb ?? r.quantRgb;
      r.components.forEach((comp, j) => {
        const partName = `top-color-${i}-${j}`;
        regions.push({
          filamentRgb: s.partOverrides?.[partName] ?? baseColor,
          coverage: r.coverage, // Use the parent coverage for priority
          rings: comp.rings,
          partName,
        });
      });
    });

    const isBlocks = blocksMode;
    const params = buildParamsFor(s);

    if (quiet) {
      // Live edit preview (extrude / edges): rebuild silently — no full-screen overlay.
    } else if (isInitialLoad) {
      store.set({ status: 'Building clicker…' });
    } else {
      store.set({ building: true, status: 'Building clicker…' });
    }
    if (isBlocks) {
      worker.postMessage({ type: 'buildBlocks', regions, params });
    } else {
      worker.postMessage({ type: 'buildClicker', regions, outline: regionSet.outline, params });
    }
  }

  // ---- Debounce ----
  function debounce(fn: () => void, ms: number) {
    let t = 0;
    return () => {
      clearTimeout(t);
      t = window.setTimeout(fn, ms);
    };
  }
  const debouncedRebuild = debounce(rebuild, 130);
  // Quiet rebuild used by live edit modes (extrude / edges) so the preview reflects
  // the real geometry without flashing the loading overlay on every step.
  const debouncedQuietRebuild = debounce(() => rebuild(true), 160);
  const debouncedReprocess = debounce(reprocess, 220);

  function hexToRgb(hex: string): RGB {
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
  }
  function rgbToHex(rgb: RGB): string {
    return (
      '#' +
      rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
    );
  }
  function firstLine(s: string): string {
    return s.split('\n')[0];
  }

  // ---- Render / project save-load / AI prompt ----
  function imageToDataUrl(img: RgbaImage): string {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
    return c.toDataURL('image/png');
  }

  function dataUrlToImage(url: string): Promise<RgbaImage> {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => {
        const c = document.createElement('canvas');
        c.width = im.naturalWidth;
        c.height = im.naturalHeight;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(im, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height);
        resolve({ data: d.data, width: c.width, height: c.height });
      };
      im.onerror = () => reject(new Error('bad image data'));
      im.src = url;
    });
  }

  /**
   * The saved shape, in one function.
   *
   * Split out of the Save handler because the host now asks for it on a timer as well as when
   * the user presses Save — autosave cannot go through a function whose other half writes
   * a file and sets a status line.
   */
  function buildProject() {
    const s = store.get();
    return {
      version: 3,
      settings: {
        colorCount: s.colorCount,
        baseShape: s.baseShape,
        capWidthMm: s.capWidthMm,
        topThickness: s.topThickness,
        imageDepth: s.imageDepth,
        capProud: s.capProud,
        hollowBase: s.hollowBase,
        fixedSize: s.fixedSize,
        designScale: s.designScale,
        shapeSides: s.shapeSides,
        shapeCornerPct: s.shapeCornerPct,
        shapeArmPct: s.shapeArmPct,
        packShapeToken: s.packShapeToken,
        /* A drawn shape's POINTS, inline, and only when there is one.
           A pack shape saves a token because the directory can re-fetch and re-trace it; a
           shape somebody drew has no directory behind it, so the token seam would reload it as
           a plain circle with nothing reporting a problem — "the design comes back and its
           SHAPE quietly does not", which the load path below already calls the worst kind of
           load bug. It follows `currentSvgText`'s precedent instead: the payload IS the file.
           A few hundred numbers, next to a base64 image. */
        // Only where the shape editor exists, and never in the MakerWorld build: a drawn outline
        // is the editor's output, and a project file is a document that leaves the app.
        // See the note in `applyProject`.
        drawnShapeRings: !__SHAPE_EDITOR__ || MAKERLAB
          ? null
          : (ringsForState(s) && !s.packShapeToken ? ringsForState(s) : null),
        tolerance: s.tolerance,
        stemFitMm: s.stemFitMm,
        socketFitPct: s.socketFitPct,
        imageOffset: s.imageOffset,
        switches: s.switches,
        keychain: s.keychain,
        smoothing: s.smoothing,
        removeBg: s.removeBg,
        importMode: s.importMode,
        currentText,
        textSymbols: s.textSymbols,
        currentFontId,
        currentSvgText,
        currentSvgOptions,
        currentSvgName,
        currentIconText,
        currentIconName,
        currentImageName,
        colorMode: s.colorMode,
        limitedColors: s.limitedColors,
        bodyColorRgb: s.bodyColorRgb,
        paletteOverrides: s.paletteOverrides,
        baseColorOverride: s.baseColorOverride,
        partOverrides: s.partOverrides,
        customColors: s.customColors,
        edgeSettings: s.edgeSettings,
        extrudeChamfer: s.extrudeChamfer,
        separateLetters: s.separateLetters,
        lineSpacing: s.lineSpacing,
        letterSpacing: s.letterSpacing,
        textBold: s.textBold,
        textScale: s.textScale,
        componentHeights: s.componentHeights,
        // Blocks mode: the arrangement, what is on the keys, the look, and the keyring.
        blockLayout: s.blockLayout,
        blockGridRows: s.blockGridRows,
        blockGridCols: s.blockGridCols,
        blockCells: s.blockCells,
        blockLines: s.blockLines,
        blockSymbols: s.blockSymbols,
        blockStyle: s.blockStyle,
        blockTexture: s.blockTexture,
        legendScale: s.legendScale,
        legendBold: s.legendBold,
        keychainEnd: s.keychainEnd,
        keychainSlideMm: s.keychainSlideMm,
        modelCut: s.modelCut,
      },
      palette: s.palette, // filament mappings
      image: originalImage ? imageToDataUrl(originalImage) : null,
      model: modelForProject(),
    };
  }

  /** The model a Model-mode project was made from: which sample, or the uploaded file itself,
   *  deflated — the file IS the design, the same way `image` is for an image clicker. Past 30 MB
   *  it is left out rather than making a project file nobody can open; the settings still save. */
  function modelForProject(): { name: string; sample?: SampleId; data?: string } | null {
    if (store.get().importMode !== 'model') return null;
    const snap = modelMode.snapshot();
    if (!snap) return null;
    if (snap.sample) return { name: snap.name, sample: snap.sample };
    if (!snap.bytes || snap.bytes.byteLength > 30 * 1024 * 1024) return null;
    return { name: snap.name, data: bytesToBase64(deflateSync(new Uint8Array(snap.bytes))) };
  }

  /** The project currently open, so Save overwrites it instead of piling up copies. */
  let currentProjectId: string | undefined;

  /** The preview the Open list shows. A save is still worth doing without one. */
  function capturePreview(): string | undefined {
    const canvas = container.querySelector('canvas') as HTMLCanvasElement | null;
    try {
      return canvas?.toDataURL('image/png');
    } catch {
      return undefined;
    }
  }

  async function saveToHost(proj: unknown) {
    if (!host) return;
    const suggested = currentSvgName || currentIconName || 'Clicker';
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
        params: proj,
        previewDataUrl: capturePreview(),
      });
      currentProjectId = saved.id;
      store.set({ status: `Saved "${saved.name}" ✓` });
    } catch (err) {
      store.set({ status: 'Could not save: ' + String(err) });
    }
  }

  async function openFromHost() {
    if (!host) return;
    let projects: Awaited<ReturnType<DesktopHost['listProjects']>>;
    try {
      projects = await host.listProjects();
    } catch (err) {
      store.set({ status: 'Could not read your projects: ' + String(err) });
      return;
    }
    if (!projects.length) {
      store.set({ status: 'No saved projects yet' });
      return;
    }

    const list = document.createElement('div');
    list.className = 'ck-project-list';
    const handle = dialog({ title: 'Open a project', content: list });

    for (const p of projects) {
      // The host turns a path into a URL. The form can differ between platforms, so a
      // hand-written one can be a broken thumbnail with nothing in the console to say why.
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
   * clicked a saved clicker in the app's picker rather than the generator's own tile, and
   * making them find it again in a dialog would be a strange way to honour that click.
   */
  async function openProject(projectId: string) {
    if (!host) return;
    try {
      const project = await host.loadProject(projectId);
      await applyProject(project.params);
      currentProjectId = project.id;
      store.set({ status: `Opened "${project.name}" ✓` });
    } catch (err) {
      store.set({ building: false, status: 'Could not open: ' + String(err) });
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
    suggestName: () => currentSvgName || currentIconName || 'Clicker',
  });

  // Only when the host is *not* owning projects: with `registerProject` it opens the
  // arriving project itself, and doing it here too would open it twice.
  if (!host?.registerProject) {
    const arrivingWith = host?.initialProjectId?.();
    if (arrivingWith) void openProject(arrivingWith);
  }

  /** Applies a saved parameter blob to the live UI. Shared by both load paths. */
  async function applyProject(raw: unknown) {
    {
      exitFitTest();
      store.set({ building: true, status: 'Loading project…' });
      const proj = raw as Record<string, any>;
      const set = proj.settings ?? {};

      currentText = set.currentText ?? 'Custom\nText';
      // The clicker's own copies of the shared faces were saved as `bundled-<slug>`.
      currentFontId = currentFontIdOf(set.currentFontId ?? 'helvetiker-regular');
      if (!(await ensureFont(currentFontId))) currentFontId = 'helvetiker-regular';
      ui.setFont(currentFontId);
      currentSvgText = set.currentSvgText ?? '';
      // Without this a project whose SVG needed "fill the outlines" reloads as hairlines.
      currentSvgOptions = set.currentSvgOptions ?? {};
      currentSvgName = set.currentSvgName ?? '';
      currentIconText = set.currentIconText ?? '';
      currentIconName = set.currentIconName ?? '';
      currentImageName = set.currentImageName ?? '';

      if (currentSvgText && currentSvgName) {
        ui.addUploadedSvg(currentSvgText, currentSvgName);
      }

      store.set({
        importMode: set.importMode ?? 'image',
        colorCount: set.colorCount ?? store.get().colorCount,
        baseShape: set.baseShape ?? store.get().baseShape,
        imageOffset: set.imageOffset ?? { x: 0, y: 0 },
        capWidthMm: set.capWidthMm ?? store.get().capWidthMm,
        topThickness: set.topThickness ?? store.get().topThickness,
        imageDepth: set.imageDepth ?? store.get().imageDepth,
        capProud: set.capProud ?? 4.0,
        hollowBase: set.hollowBase ?? false,
        // Absent in every project saved before this control existed, and absent MEANS off —
        // so an old project keeps rendering at exactly the size it always did.
        fixedSize: set.fixedSize ?? null,
        // Absent means 1 — every project saved before this control existed renders unchanged.
        designScale: set.designScale ?? 1,
        /* Per-shape, not a flat 6.
           `?? 6` looked harmless and silently changed geometry: `makeStar` used to be called
           with its own default of 5 and nothing else, so every star ever saved was 5-pointed —
           and a flat 6 is not nullish, so `sides(5, …)`'s fallback never fires and the star
           reloads with six points. The directory already knows each shape's default. */
        shapeSides: set.shapeSides ?? findShape(set.baseShape ?? '')?.param?.value ?? 6,
        // Per-field `?? default` is this codebase's only real compatibility mechanism —
        // `version` is written and never read — so a project saved before this knob existed
        // loads with the shipped default and builds exactly what it always built.
        shapeArmPct: set.shapeArmPct ?? 0.34,
        shapeCornerPct: set.shapeCornerPct ?? 0.22,
        packShapeToken: set.packShapeToken ?? null,
        drawnShapeId: null,
        tolerance: set.tolerance ?? store.get().tolerance,
        // `stemFitPct` (saved until 2026-09-17) scaled the post, which widened the gripping
        // arms by pct% of their 1.194 mm — so that IS the clearance it produced, and it converts
        // exactly. Every value it could hold lands on 0 or one 0.05 mm step either side. v3's
        // `stemTolerance` scaled the whole post in mm and is still dropped rather than guessed.
        stemFitMm: typeof set.stemFitMm === 'number'
          ? Math.max(STEM_FIT_MIN_MM, Math.min(STEM_FIT_MAX_MM, set.stemFitMm))
          : Math.round((((set.stemFitPct ?? 0) * 0.01194) / STEM_FIT_STEP_MM)) * STEM_FIT_STEP_MM || 0,
        socketFitPct: set.socketFitPct ?? 0,
        // v3 stores `switches`; older (v2) projects carried scalar offsets — synthesize
        // a single-switch array from them for back-compat.
        switches: Array.isArray(set.switches) && set.switches.length
          ? set.switches
          : [{ x: set.switchOffsetX ?? 0, y: set.switchOffsetY ?? 0, rotation: set.switchRotation ?? 0 }],
        activeSwitchIndex: 0,
        // v3 stores a keychain object; older projects had a boolean (or nothing).
        keychain: set.keychain && typeof set.keychain === 'object'
          ? { offsetMm: 0, ...set.keychain }
          : { enabled: set.keychain === true, style: 'loop', angleDeg: 90, holeDiameterMm: 5.2, offsetMm: 0 },
        smoothing: set.smoothing ?? store.get().smoothing,
        removeBg: set.removeBg ?? store.get().removeBg,
        currentIconName: currentIconName || 'circle',
        colorMode: set.colorMode ?? 'normal',
        limitedColors: set.limitedColors ?? [],
        bodyColorRgb: set.bodyColorRgb ?? [120, 124, 130],
        paletteOverrides: set.paletteOverrides ?? [],
        partOverrides: set.partOverrides ?? {},
        customColors: set.customColors ?? [],
        edgeSettings: set.edgeSettings ?? store.get().edgeSettings,
        extrudeChamfer: set.extrudeChamfer ?? false,
        separateLetters: set.separateLetters ?? false,
        lineSpacing: set.lineSpacing ?? 1,
        letterSpacing: set.letterSpacing ?? 0,
        textBold: set.textBold ?? 0,
        textScale: set.textScale ?? 1,
        componentHeights: set.componentHeights ?? {},
        keychainEnd: set.keychainEnd ?? 'left',
        keychainSlideMm: set.keychainSlideMm ?? 0,
        // Blocks: a project from before blocks were saved opens on the defaults.
        ...loadedBlocks(set),
        // Text mode's symbols; a project from before them has none.
        textSymbols: loadedSymbols(set.textSymbols) ?? {},
      });
      ui.setText(currentText);

      // Model mode: the cut settings, then the model they were made on. Nothing below this
      // (the picture, the pack shapes, the palette) belongs to a model, so it returns here.
      if (set.importMode === 'model') {
        store.set({ modelCut: { ...DEFAULT_MODEL_CUT, ...(set.modelCut ?? {}) } });
        const m = proj.model as { name?: string; sample?: SampleId; data?: string } | null | undefined;
        if (m?.sample) {
          modelMode.restore({ name: m.name ?? m.sample, bytes: null, sample: m.sample });
        } else if (m?.data) {
          const packed = Uint8Array.from(atob(m.data), (ch) => ch.charCodeAt(0));
          const bytes = inflateSync(packed);
          modelMode.restore({
            name: m.name ?? 'model.stl',
            bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
            sample: null,
          });
        } else {
          store.set({ status: 'This project did not keep its model. Upload it again to carry on.' });
        }
        return;
      }

      if (set.importMode === 'image' && proj.image) {
        originalImage = await dataUrlToImage(proj.image);
      }

      /* Re-fetch a seasonal-pack silhouette. The rings are derived, not saved — a project
         file holds the token — so without this a saved pumpkin reloads as `baseShape:
         'custom'` with no rings, which buildClicker renders as a circle. The design would
         come back and its SHAPE would quietly not, which is the worst kind of load bug:
         nothing errors and the file looks like it worked.

         Awaited before `reprocess()` so the first build already has them; a failure leaves
         the base as a circle and says so rather than pretending. */
      /* Restore the base silhouette.

         Everything that is not a built-in `BaseShapeKind` is stored as `baseShape: 'custom'`
         plus a token, and the RINGS are derived rather than saved — so without this the design
         reloads and its shape quietly does not, which `makeCustom` renders as a plain circle.
         Nothing errors and the file looks like it worked, which is the worst kind of load bug.

         One lookup for every token kind, deliberately. The first cut of this went through
         `resolveShape`, which only knows about seasonal packs: a library token (`lib:heart`)
         made it call `findPack('lib')`, get null, and fall through in silence — so every one of
         the 371 library shapes reloaded as a circle. `findShape` resolves all three, and
         `loadPackShapes` is awaited first so the pack entries exist to be found. */
      packShapeRings = null;
      let loadedDrawnId: string | null = null;
      /* A shape drawn in the editor: its points are in the file, so there is nothing to fetch.
         Checked BEFORE the token branch and mutually exclusive with it by construction — a
         drawn shape never has a token, which is the same fact that tells `buildParamsFor`
         which of the two ring sets to use. */
      /* Drawn geometry does not travel in project files. A drawn shape is the shape editor's
         output, so outside a build that has the editor, and always in the MakerWorld build, the
         rings are ignored here and never written in the first place (see buildProject). The
         design falls back to its preset, the same way the pack-token branch does when a shape
         cannot be resolved. */
      const savedRings = !__SHAPE_EDITOR__ || MAKERLAB
        ? undefined
        : (proj.settings as { drawnShapeRings?: Ring[] })?.drawnShapeRings;
      if (Array.isArray(savedRings) && savedRings.length) {
        const clean = savedRings.filter((r) => Array.isArray(r) && r.length >= 3);
        if (clean.length) loadedDrawnId = rememberDrawing(clean);
        else store.set({ status: 'The base shape this project uses could not be loaded.' });
      }
      store.set({ drawnShapeId: loadedDrawnId });
      const savedToken = set.packShapeToken ?? '';
      if (savedToken) {
        try {
          await loadPackShapes();
          const savedEntry = findShape(savedToken);
          if (savedEntry?.rings?.length) packShapeRings = savedEntry.rings;
          else store.set({ status: 'The base shape this project uses could not be loaded.' });
        } catch (err) {
          console.error('[shapes] saved base shape failed to load', err);
          store.set({ status: 'The base shape this project uses could not be loaded.' });
        }
      }

      reprocess();

      if (Array.isArray(proj.palette)) {
        const pal = store.get().palette.map((p, i) => ({
          ...p,
          filamentRgb: proj.palette[i]?.filamentRgb ?? p.filamentRgb,
        }));
        store.set({ palette: pal, baseColorOverride: set.baseColorOverride ?? null });
        rebuild();
      }
    }
  }

  const AI_PROMPT = [
    'Create a simple, flat vector-style illustration suitable for a small multi-color 3D print.',
    'Requirements:',
    '- Bold, clean shapes with thick outlines; no gradients, no shading, no texture.',
    '- A small number of FLAT solid colors (4–6 max), each clearly separated.',
    '- Centered subject on a plain solid (or transparent) background.',
    '- High contrast between adjacent colors; avoid thin slivers and tiny details.',
    '- Square-ish framing, subject fills ~80% of the canvas.',
    'Subject: <describe your subject here>.',
  ].join('\n');

  /* ------------------------------------------------------- Paid features (MakerWorld only)

     The panel renders into `#proMount`, an empty div the sidebar lays out, and reaches the
     generator through the narrow `ProDeps` seam declared in makerlab.d.ts. It never touches
     the worker, the viewer or the store directly — everything it needs is a function passed
     in here, which is what keeps the paid module swappable and the shell free of it.

     `paramsPatch()` is how paid geometry reaches a build: `rebuild()` merges it over the
     params it just assembled. In the public build the module is an inline stub that returns
     `{}`, and this whole branch is dead code behind `MAKERLAB` on top of that. */
  if (MAKERLAB) {
    const proHost = container.querySelector<HTMLElement>('#proMount');
    if (proHost) {
      proPanel = mountProFeatures({
        host: proHost,
        ctaHost: container.querySelector<HTMLElement>('#licenceCtaMount') ?? undefined,
        getState: () => {
          const st = store.get();
          return {
            importMode: st.importMode,
            fontId: currentFontId,
            separateLetters: st.separateLetters,
            palette: st.palette,
            params: buildParamsFor(st),
          };
        },
        setStatus: (msg) => store.set({ status: msg }),
        buildOne,
        showParts: (parts) => {
          exitFitTest();
          latestParts = parts;
          viewer.setParts(parts, false);
          viewer.setView(store.get().view);
          viewer.setSwitchPlacements([]);
          store.set({ building: false, hasParts: parts.length > 0 });
        },
        rebuild: () => debouncedRebuild(),
      });
      cleanups.push(() => proPanel?.destroy());
      cleanups.push(store.subscribe(() => proPanel?.refresh()));
    }
  }

  return () => {
    // Dialogs and the UI's own modals live on <body>, outside the container the host
    // clears — each has to be closed rather than merely dropped.
    closeAllDialogs();
    // The UI owns most of what got attached outside the container — the tooltip bubble, the
    // welcome modal, the colour popovers, and the document-level hover and drop handlers.
    ui.dispose();
    for (const fn of cleanups.reverse()) {
      try { fn(); } catch { /* one failed cleanup must not strand the rest */ }
    }
    cleanups.length = 0;
    container.classList.remove('cg-mount');
    container.replaceChildren();
  };
}
