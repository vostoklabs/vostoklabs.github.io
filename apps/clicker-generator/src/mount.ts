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
import '@vostok/plates/plates.css';
import { topbarLinks, isDesktop } from '@vostok/ui-kit';
import './style.css';
import { createStore } from './store/store';
import { createViewer } from './viewer/viewer';
import { mountPlatePicker } from '@vostok/plates';
import { createUi, type UiState } from './ui/ui';
import { loadFileToImage, type RgbaImage } from './image/decode';
import { processImage } from './image/pipeline';
import { runWizard } from './ui/wizard';
import { buildThreeMF, downloadThreeMF } from './export/threemfExport';
import { buildObjMtl, objToArrayBuffer } from './export/objExport';
import { parseSvg } from './image/logo';
import { SAMPLES, SVG_SAMPLES } from './image/sample';
import { parseLetter, parseBlockChain, importFontFile } from './image/letter';
import { LUCIDE_ICONS, buildSvg } from './image/lucideIcons';
// MakerLab integration seam. Resolves to a no-op stub in the public build and to the real
// SDK glue in the MakerWorld build (`--mode makerworld`) — see vite.config.ts.
import {
  MAKERLAB,
  initMakerlab,
  isReady as mlReady,
  can as mlCan,
  sdkExport,
  sdkToast,
} from 'virtual:makerlab';
import type {
  BlockSlot,
  BuildParams,
  BuildRegion,
  ClickerPart,
  EdgeStyle,
  GeometryResponse,
  PaletteEntry,
  RegionSet,
  RGB,
  SwitchPlacement,
} from './types';
import { FILAMENTS } from './types';

import type { DesktopHost } from '@vostok/ui-kit';
import { closeAllDialogs, dialog } from '@vostok/ui-kit';
import { setAssetBase, assetBase } from './assets';
import { TEMPLATE } from './template';

/**
 * Builds the generator into `container` and returns its teardown.
 *
 * `host` is absent on the web, and every capability it carries has a browser fallback this
 * generator already implements — Save becomes a JSON download, Load a file picker, Export a
 * download. That is what keeps one source building for both.
 */
export function mount(container: HTMLElement, host?: DesktopHost): () => void {
  setAssetBase(host?.assetBase?.() ?? undefined);
  // The container is the app's layout column — see `.cg-mount` in style.css. It has to be
  // set here rather than on `#root` in index.html, because on the desktop host there is no
  // index.html and the container is an element the host owns.
  container.classList.add('cg-mount');
  container.innerHTML = TEMPLATE;

  /** Everything the teardown has to undo, in the order it was set up. */
  const cleanups: (() => void)[] = [];


  // Mount the unified Vostok topbar — except in the MakerWorld build, where the host provides
  // its own chrome and links out of the iframe wouldn't work anyway.
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
    fetch(base + 'assets/blocks/block no sides to connect.3mf').then((r) => r.arrayBuffer()),
    fetch(base + 'assets/blocks/block south side to connect.3mf').then((r) => r.arrayBuffer()),
    fetch(base + 'assets/blocks/block north and south side to connect.3mf').then((r) => r.arrayBuffer()),
    // Grid shells: a corner (two adjacent faces), an edge (three) and an interior (four).
    fetch(base + 'assets/blocks/block north and west side to connect.3mf').then((r) => r.arrayBuffer()),
    fetch(base + 'assets/blocks/block north, south and west side to connect.3mf').then((r) => r.arrayBuffer()),
    fetch(base + 'assets/blocks/block all sides to connect.3mf').then((r) => r.arrayBuffer()),
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
    colorCount: 4,
    palette: [],
    baseShape: 'outline',
    capWidthMm: 35,
    topThickness: 1.5,
    imageDepth: 0.8,
    tolerance: 0.4,
    stemTolerance: 0,
    switches: [{ x: 0, y: 0, rotation: 0 }],
    activeSwitchIndex: 0,
    smoothing: 0.1,
    keychain: { enabled: false, style: 'loop', angleDeg: 90, holeDiameterMm: 5.2, offsetMm: 0 },
    removeBg: true,
    view: 'exploded',
    showSwitch: true,
    importMode: 'image', // Land on the Image tab by default
    currentIconName: 'circle',
    colorMode: 'normal',
    limitedColors: [],
    bodyColorRgb: [240, 240, 240] as RGB,
    paletteOverrides: [],
    baseColorOverride: null,
    imageOffset: { x: 0, y: 0 },
    partOverrides: {},
    editMode: 'color',
    edgeSettings: [
      { target: 'capTop', style: 'chamfer', radius: 0.5 },
      // One control for the whole clicker base — bevels top + bottom body edges together.
      { target: 'clickerBase', style: 'chamfer', radius: 0.5 },
    ],
    extrudeChamfer: false,
    separateLetters: false,
    // ---- Letter blocks ----
    blockSlots: [
      { kind: 'char', ch: 'N' },
      { kind: 'char', ch: 'a' },
      { kind: 'char', ch: 'm' },
      { kind: 'char', ch: 'e' },
    ],
    blockOrientation: 'horizontal',
    legendScale: 1,
    legendBold: 0,
    keychainEnd: 'left',
    extrudeHeight: null,
    componentHeights: {},
    selectedParts: [],
    canUndo: false,
    canRedo: false,
    canRefresh: false,
  });

  // ---- Heavy data kept out of the reactive store ----
  let originalImage: RgbaImage | null = null; // pristine decode (never mutated)
  let regionSet: RegionSet | null = null;
  let latestParts: ClickerPart[] = [];
  let assetsReady = false;
  let defaultClickerLoaded = false;

  // Vector states
  let currentSvgText = '';
  let currentSvgName = '';
  let currentIconText = '';
  let currentIconName = '';
  let currentText = 'Custom\nText';
  let currentFontId = 'helvetiker-regular';
  let isInitialLoad = true;

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

  const ui: ReturnType<typeof createUi> = createUi(sidebarLeft, sidebarRight, statusEl, {
    onUpload: (file) => openWizard(() => loadFileToImage(file)),
    onSample: (load) => openWizard(load),
    onColorCount: (n) => {
      store.set({ colorCount: n });
      debouncedReprocess();
    },
    onFilament: (i, hex) => {
      // Live recolor (same path as clicking the color on the 3D model). A color change
      // never changes geometry, so we skip the full worker rebuild — picking a filament
      // in the left menu now behaves exactly like recoloring in Color mode.
      if (!store.get().palette[i]) return;
      applyModelRecolor({ kind: 'region', index: i, compIndex: 0 }, hexToRgb(hex), -1);
    },
    onShape: (kind) => {
      store.set({ baseShape: kind });
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
    onSocketTolStep: (delta) => {
      // "Switch socket" fit = clearance between the top and the base it presses into.
      // Baseline is 0.4 mm (shown as 0); + loosens, − tightens. Clamp to a safe range.
      const next = Math.round(Math.max(0.1, Math.min(1.0, store.get().tolerance + delta)) * 100) / 100;
      store.set({ tolerance: next });
      debouncedRebuild();
    },
    onStemTolStep: (delta) => {
      // "Switch stem" fit = XY scale offset on the cap's keycap-mount stem (0.2 mm steps).
      // + loosens (opens the cross socket), − tightens. 0 = as authored.
      const next = Math.round(Math.max(-1.0, Math.min(1.0, store.get().stemTolerance + delta)) * 10) / 10;
      store.set({ stemTolerance: next });
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
    onKeychainToggle: (on) => {
      store.set({ keychain: { ...store.get().keychain, enabled: on } });
      debouncedRebuild();
    },

    onKeychainRotate: (deltaDeg) => {
      const kc = store.get().keychain;
      const angleDeg = (((kc.angleDeg + deltaDeg) % 360) + 360) % 360;
      store.set({ keychain: { ...kc, angleDeg } });
      debouncedRebuild();
    },
    onKeychainSize: (deltaMm) => {
      const kc = store.get().keychain;
      const holeDiameterMm = Math.round(Math.max(3.0, Math.min(8.0, kc.holeDiameterMm + deltaMm)) * 10) / 10;
      store.set({ keychain: { ...kc, holeDiameterMm } });
      debouncedRebuild();
    },
    onKeychainOffset: (deltaMm) => {
      const kc = store.get().keychain;
      const offsetMm = Math.round(Math.max(-15.0, Math.min(15.0, (kc.offsetMm ?? 0) + deltaMm)) * 10) / 10;
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
    onView: (mode) => {
      store.set({ view: mode });
      viewer.setView(mode);
    },
    onShowSwitch: (on) => {
      store.set({ showSwitch: on });
      viewer.showSwitch(on);
    },
    onSection: (axis, pos) => viewer.setSection(axis, pos),
    onExport: async () => {
      if (!latestParts.length) return;
      if (MAKERLAB && mlReady() && mlCan('export')) {
        // MakerWorld path: follow the SDK guide's OBJ route — hand the host an OBJ (one `o`
        // object per colour region) plus an MTL carrying those colours, and the host converts
        // it into the 3MF the user receives. Per MakerWorld's 2026-07-27 review this replaces
        // the previous ZIP-with-our-own-.3mf-inside approach.
        const status = (msg: string) => store.set({ status: msg });
        status('Sending to MakerLab…');
        try {
          const { obj, mtl } = buildObjMtl(latestParts, 'clicker.mtl');
          // Capture a cover image from the WebGL canvas.
          const canvas = container.querySelector('canvas') as HTMLCanvasElement | null;
          const coverImage = canvas?.toDataURL('image/png') ?? '';
          const result = await sdkExport({
            artifacts: [
              {
                fileName: 'clicker.obj',
                format: 'obj',
                buffer: objToArrayBuffer(obj),
                mtl,
                coverImage,
                description: 'Multi-color clicker, made with the Clicker Generator.',
              },
            ],
          });
          if (result.success) {
            status('Exported to MakerLab ✓');
            sdkToast({ message: 'Clicker exported', type: 'success' });
          } else {
            status(`Export failed: ${result.errorMessage ?? result.errorCode}`);
            sdkToast({ message: 'Export failed', type: 'error' });
          }
        } catch (err) {
          status('Export error: ' + String(err));
          console.error('[MakerLab export]', err);
        }
      } else if (host) {
        // The whole reason the desktop bundle exists: the file does not land in Downloads
        // for you to go and find, it lands in the library and shows up in the grid.
        try {
          const { indexed } = await host.exportToLibrary(
            { name: 'clicker.3mf', bytes: buildThreeMF(latestParts) },
            { designer: 'Clicker Generator' },
          );
          store.set({ status: indexed ? 'Exported to your library ✓' : 'Exported as clicker.3mf ✓' });
        } catch (err) {
          store.set({ status: 'Export failed: ' + String(err) });
        }
      } else {
        // Standalone / public path: direct browser download + license reminder.
        downloadThreeMF(latestParts, 'clicker.3mf');
        // First download of the session → big license modal; later ones → quiet corner toast.
        // The counter is in-memory, so a page refresh re-shows the big modal on the next download.
        downloadCount += 1;
        if (downloadCount === 1) showLicenseModal();
        else showLicenseToast();
      }
    },
    onRenderPng: async () => {
      const blob = await viewer.renderToPng();
      if (blob) downloadBlob(blob, 'clicker-render.png');
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
    onSaveProject: () => saveProject(),
    onLoadProject: (file) => loadProject(file),
    onOpenFromHost: () => void openFromHost(),
    onBodyColor: (hex) => {
      // Live recolor of the clicker body — no rebuild (geometry is unchanged). A block
      // chain has no 'base-body' part; its bodies are block-0…block-N, so match either.
      const idx = latestParts.findIndex((p) => p.name === 'base-body' || /^block-\d+$/.test(p.name));
      if (idx >= 0) applyModelRecolor({ kind: 'body' }, hexToRgb(hex), idx);
      else store.set({ bodyColorRgb: hexToRgb(hex) });
    },

    onImportMode: (mode) => {
      const s = store.get();
      pendingReframe = true;
      store.set({
        importMode: mode,
        baseShape: mode === 'text' ? 'outline' : s.baseShape,
        colorMode: mode !== 'image' ? 'normal' : s.colorMode,
        // Part names differ per mode (blocks vs. one clicker), so a stale selection or a
        // pinned frame colour from the previous mode would apply to the wrong thing.
        selectedParts: [],
        baseColorOverride: null,
      });
      reprocess();
    },
    onSvgUpload: async (file) => {
      try {
        store.set({ building: true, status: 'Reading SVG…' });
        const svgText = await file.text();
        ui.addUploadedSvg(svgText, file.name.replace(/\.svg$/i, ''));
        store.set({ building: false });
      } catch (err) {
        store.set({ building: false, status: 'Error reading SVG: ' + String(err) });
      }
    },
    onSelectSvg: (svgText, name) => {
      pendingReframe = true;
      currentSvgText = svgText;
      currentSvgName = name;
      reprocess(); // auto-build on selection — no Generate button
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
      debouncedReprocess(); // live rebuild as you type
    },
    onBlockText: (text) => {
      // The chain is the source of truth in Blocks mode: retype the LETTER chips from the
      // box and leave the symbols where the user put them (clamped to the new length).
      const slots = store.get().blockSlots;
      const icons: { at: number; slot: BlockSlot }[] = [];
      slots.forEach((slot, i) => {
        if (slot.kind === 'icon') icons.push({ at: i, slot });
      });
      const next: BlockSlot[] = Array.from(text.replace(/\s+/g, '')).map(
        (ch) => ({ kind: 'char', ch }) as BlockSlot,
      );
      for (const { at, slot } of icons) next.splice(Math.min(at, next.length), 0, slot);
      store.set({ blockSlots: next });
      debouncedReprocess();
    },
    onBlockSlots: (slots) => {
      store.set({ blockSlots: slots });
      debouncedReprocess();
    },
    onBlockOrientation: (o) => {
      store.set({ blockOrientation: o });
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
      store.set({ keychainEnd: side });
      debouncedRebuild();
    },
    onFontSelect: (fontId) => {
      currentFontId = fontId;
      reprocess();
    },
    onImportFont: async (file) => {
      try {
        store.set({ building: true, status: 'Importing font…' });
        const font = await importFontFile(file);
        ui.addFontOption(font);
        currentFontId = font.id;
        reprocess(); // build immediately with the newly imported font
      } catch (err) {
        store.set({ building: false, status: 'Could not import font: ' + String(err) });
      }
    },
    onThemeChange: (theme) => {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('clicker_theme', theme);
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
  });

  // ---- Undo / redo ----------------------------------------------------------
  // History snapshots the editable "document" fields (colors, heights, edges,
  // shape/size). Each tracked change pushes a snapshot; re-tracing a new source
  // (reprocess) starts a fresh baseline. Restoring rebuilds the geometry.
  const HISTORY_FIELDS = [
    'palette', 'paletteOverrides', 'partOverrides', 'bodyColorRgb', 'baseColorOverride',
    'componentHeights', 'edgeSettings', 'extrudeChamfer', 'baseShape', 'capWidthMm', 'topThickness',
    'imageDepth', 'tolerance', 'stemTolerance', 'switches', 'keychain',
  ] as const;
  let history: string[] = [];
  let histIndex = -1;
  let restoringHistory = false;
  let pendingHistoryReset = false;
  /** Set when the next build should re-frame the camera (new subject, not an edit). */
  let pendingReframe = true;

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
      const options: RGB[] =
        s.colorMode === 'limited' && s.limitedColors.length > 0
          ? s.limitedColors
          : FILAMENTS.map(([, hex]) => hexToRgb(hex));
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
    if (store.get().importMode === 'blocks') {
      if (/^cap-\d+$/.test(name)) return { kind: 'part', name };
      if (/^top-color-\d+-\d+$/.test(name)) return { kind: 'part', name };
    }
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
  function applyModelRecolor(target: ColorTarget, rgb: RGB, partIndex: number) {
    const s = store.get();
    if (target.kind === 'region') {
      // Recolor EVERY component of this color across the model (not just the clicked
      // one) and update the palette swatch + overrides, so clicking a color in the
      // viewport behaves like changing its filament in the left menu (whole model).
      const i = target.index;
      // A block chain has one legend part per block (top-color-0-0, top-color-1-0, …). This
      // path is only reached from the left-hand palette there, and the palette means "all
      // of them" — so it also wipes any single letters that were recoloured by clicking.
      const blocks = s.importMode === 'blocks';
      const prefix = `top-color-${i}-`;
      const isTarget = blocks
        ? (n: string) => /^top-color-\d+-\d+$/.test(n)
        : (n: string) => n.startsWith(prefix);
      const overrides = s.partOverrides ? { ...s.partOverrides } : {};
      if (blocks) {
        for (const k of Object.keys(overrides)) if (isTarget(k)) delete overrides[k];
      }
      latestParts.forEach((p, idx) => {
        if (isTarget(p.name)) {
          viewer.setPartColor(idx, rgb);
          latestParts[idx] = { ...latestParts[idx], colorRgb: rgb };
          overrides[p.name] = rgb;
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

  worker.onmessage = (e: MessageEvent<GeometryResponse>) => {
    const msg = e.data;
    switch (msg.type) {
      case 'ready':
        initAssets();
        break;
      case 'initDone':
        assetsReady = true;
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
        latestParts = msg.parts;
        // Re-frame the camera only when the SUBJECT changed (a new image, icon, SVG, or a
        // different import mode). Editing what is already on screen — the text, the font,
        // the legend size — must leave the view exactly where the user put it.
        viewer.setParts(msg.parts, !pendingReframe);
        pendingReframe = false;
        viewer.setView(store.get().view);
        // Seat one preview switch per (clamped) placement the geometry was built around.
        viewer.setSwitchPlacements(msg.switchPlacements ?? []);

        // Extrude heights are baked into the geometry now — do NOT translate the
        // meshes too, or the raised part would float a second step above the model.
        // (Selection highlight is re-applied by the store subscription below.)

        store.set({
          building: false,
          hasParts: msg.parts.length > 0,
          // Surface any non-fatal build note (switches pinched, no keychain room) or clear.
          status: msg.warnings && msg.warnings.length ? msg.warnings[0] : '',
        });
        isInitialLoad = false;

        // After a re-trace, the first build becomes the new undo baseline.
        if (pendingHistoryReset) {
          pendingHistoryReset = false;
          resetHistory();
        }
        break;
      }
      case 'error':
        store.set({ building: false, status: 'Error: ' + firstLine(msg.message) });
        console.error('[geometry worker]', msg.message);
        isInitialLoad = false;
        break;
    }
  };
  worker.onerror = (e) => {
    store.set({ building: false, status: 'Worker failed: ' + e.message });
    console.error(e);
  };

  async function initAssets() {
    try {
      const [socket, stem, sw, blockNoSides, blockSouth, blockNorthSouth,
             blockNorthWest, blockNorthSouthWest, blockAllSides, keycapJson] = await assetsPromise;
      worker.postMessage(
        {
          type: 'init', socket, stem, switch: sw,
          blockNoSides, blockSouth, blockNorthSouth,
          blockNorthWest, blockNorthSouthWest, blockAllSides,
          keycapJson,
        },
        [socket, stem, sw, blockNoSides, blockSouth, blockNorthSouth,
         blockNorthWest, blockNorthSouthWest, blockAllSides]
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
        status: '', // Clear the banner when ready
      });
      defaultClickerLoaded = true;
      isInitialLoad = false;
    } catch (err) {
      console.warn('Failed to load pre-built default clicker, falling back to dynamic build:', err);
      if (originalImage) {
        reprocess();
      }
    }
  }

  // ---- Pipeline ----
  async function openWizard(getter: () => Promise<RgbaImage>) {
    try {
      pendingReframe = true; // a new picture is a new subject, so frame it
      store.set({ building: true, status: 'Reading image…' });
      const baseImage = await getter();
      store.set({ building: false, status: 'Preprocess your image…' });
      runWizard({
        baseImage,
        initialColorCount: store.get().colorCount,
        onCancel: () =>
          store.set({ status: originalImage ? 'Ready.' : 'Ready. Drop an image or try the sample.' }),
        onComplete: ({ adjusted, preprocess, colorCount, colorMode, limitedColors, paletteOverrides }) => {
          originalImage = adjusted;
          let defaultBodyColor = store.get().bodyColorRgb;
          if (colorMode === 'limited' && limitedColors && limitedColors.length > 0) {
            const blackHex = '#161616';
            const blackRgb = hexToRgb(blackHex);
            const hasBlack = limitedColors.some(c => c[0] === blackRgb[0] && c[1] === blackRgb[1] && c[2] === blackRgb[2]);
            defaultBodyColor = hasBlack ? blackRgb : limitedColors[0];
          }
          store.set({
            removeBg: !preprocess.keepBackground,
            colorCount,
            topThickness: Math.max(1, preprocess.thicknessMm),
            colorMode,
            limitedColors: limitedColors || [],
            bodyColorRgb: defaultBodyColor,
            paletteOverrides: paletteOverrides || [],
          });
          reprocess();
        },
      });
    } catch (err) {
      store.set({ building: false, status: 'Could not read image: ' + String(err) });
    }
  }

  function reprocess() {
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
        customColors: s.colorMode === 'limited' ? s.limitedColors : undefined,
      });
    } else if (s.importMode === 'svg') {
      if (!currentSvgText) {
        store.set({ status: 'Upload an SVG file first.' });
        return;
      }
      try {
        store.set({ building: true, status: 'Parsing SVG…' });
        regionSet = parseSvg(currentSvgText, { removeBg: s.removeBg });
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
        store.set({ building: true, status: 'Parsing Icon…' });
        regionSet = parseSvg(currentIconText);
      } catch (e: any) {
        store.set({ building: false, status: 'Error: ' + e.message });
        return;
      }
    } else if (s.importMode === 'blocks') {
      try {
        store.set({ building: true, status: 'Generating blocks…' });
        regionSet = parseBlockChain(s.blockSlots, currentFontId);
      } catch (e: any) {
        store.set({ building: false, status: 'Error: ' + e.message });
        return;
      }
    } else if (s.importMode === 'text') {
      try {
        store.set({ building: true, status: 'Generating Text…' });
        regionSet = parseLetter(currentText, currentFontId, 15, s.separateLetters);
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
      store.set({ building: false, status: 'No outline found.' });
      return;
    }
    rebuild();
  }

  function rebuild(quiet = false) {
    if (!regionSet || regionSet.regions.length === 0) return;
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

    // Icons are line-art (a single-color silhouette), not a multi-color picture.
    // Using their thin stroke as the body outline makes a broken ring, so the body
    // is always a solid shape (circle/square) and the icon rides on top as a design.
    const isIcon = s.importMode === 'icon';
    const effectiveBaseShape = isIcon && s.baseShape === 'outline' ? 'circle' : s.baseShape;
    // The cap backing contrasts line-art designs so they stay visible (see
    // deriveFrameColor). A frame the user pinned by clicking the model wins over it.
    const capBaseColor: RGB = s.baseColorOverride ?? deriveFrameColor(s);

    const isBlocks = blocksMode;
    const isText = s.importMode === 'text' || isBlocks;
    const params: BuildParams = {
      baseShape: effectiveBaseShape,
      capWidthMm: s.capWidthMm,
      topThickness: Math.max(1, s.topThickness),
      imageDepth: s.imageDepth,
      imageMargin: isText ? 2.5 : 1.2,
      borderWidth: isText ? 3.5 : 2.6,
      capProud: 4.0,
      tolerance: s.tolerance,
      stemTolerance: s.stemTolerance,
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
      blockOrientation: s.blockOrientation,
      legendScale: s.legendScale,
      legendBold: s.legendBold,
      keychainEnd: s.keychainEnd,
      partOverrides: s.partOverrides,
    };

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

  // ---- License reminders on download ----
  // In-memory only (resets on refresh) so the big modal reappears for new sessions.
  let downloadCount = 0;

  const COMMERCIAL_URL = 'https://makerworld.com/en/@Vostok_Labs#commercial-membership-open';
  const LICENSE_URL = 'https://creativecommons.org/licenses/by-nc-nd/4.0/';

  function showLicenseModal() {
    if (document.querySelector('.license-overlay')) return;
    const wm = document.createElement('div');
    wm.className = 'license-overlay';
    wm.innerHTML = `
      <div class="license-card">
        <div class="license-badge">✓ Download started</div>
        <h2>Free for personal use</h2>
        <p>
          This generator and the designs it creates are released under a
          <a href="${LICENSE_URL}" target="_blank" rel="noopener noreferrer">CC BY-NC-ND 4.0 license</a>.
          Print as many as you like for yourself, completely free.
        </p>
        <div class="license-commercial">
          <div class="license-commercial-title">Want to <span>sell</span> your prints?</div>
          <p>
            If you plan to sell these as 3D-printed products, you need a
            <strong>commercial license membership</strong>, it's just
            <strong class="license-price">$15&nbsp;/&nbsp;month</strong> and unlocks full commercial rights.
          </p>
          <a class="license-cta" href="${COMMERCIAL_URL}" target="_blank" rel="noopener noreferrer">
            Get the commercial license →
          </a>
        </div>
        <div class="license-foot">
          <button class="primary" id="licenseClose" style="min-width:150px">Got it</button>
        </div>
      </div>
    `;
    document.body.appendChild(wm);
    const close = () => wm.remove();
    wm.querySelector('#licenseClose')!.addEventListener('click', close);
    wm.addEventListener('click', (e) => {
      if (e.target === wm) close();
    });
  }

  let licenseToastTimer: number | undefined;
  function showLicenseToast() {
    document.querySelector('.license-toast')?.remove();
    if (licenseToastTimer) window.clearTimeout(licenseToastTimer);
    const t = document.createElement('div');
    t.className = 'license-toast';
    t.innerHTML = `
      <button class="license-toast-x" aria-label="Dismiss">×</button>
      <div class="license-toast-title">✓ Free for personal use</div>
      <p>Selling printed designs? You need a commercial license.</p>
      <a class="license-toast-cta" href="${COMMERCIAL_URL}" target="_blank" rel="noopener noreferrer">
        Get commercial license →
      </a>
    `;
    document.body.appendChild(t);
    // Trigger the slide-in transition on the next frame.
    requestAnimationFrame(() => t.classList.add('show'));
    const dismiss = () => {
      t.classList.remove('show');
      window.setTimeout(() => t.remove(), 300);
    };
    t.querySelector('.license-toast-x')!.addEventListener('click', dismiss);
    // Linger long enough not to miss it.
    licenseToastTimer = window.setTimeout(dismiss, 9000);
  }

  // ---- Render / project save-load / AI prompt ----
  function downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

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

  function saveProject() {
    const s = store.get();
    const proj = {
      version: 3,
      settings: {
        colorCount: s.colorCount,
        baseShape: s.baseShape,
        capWidthMm: s.capWidthMm,
        topThickness: s.topThickness,
        imageDepth: s.imageDepth,
        tolerance: s.tolerance,
        stemTolerance: s.stemTolerance,
        imageOffset: s.imageOffset,
        switches: s.switches,
        keychain: s.keychain,
        smoothing: s.smoothing,
        removeBg: s.removeBg,
        importMode: s.importMode,
        currentText,
        currentFontId,
        currentSvgText,
        currentSvgName,
        currentIconText,
        currentIconName,
        colorMode: s.colorMode,
        limitedColors: s.limitedColors,
        bodyColorRgb: s.bodyColorRgb,
        paletteOverrides: s.paletteOverrides,
        baseColorOverride: s.baseColorOverride,
        partOverrides: s.partOverrides,
        edgeSettings: s.edgeSettings,
        extrudeChamfer: s.extrudeChamfer,
        separateLetters: s.separateLetters,
        componentHeights: s.componentHeights,
      },
      palette: s.palette, // filament mappings
      image: originalImage ? imageToDataUrl(originalImage) : null,
    };

    if (host) { void saveToHost(proj); return; }

    downloadBlob(new Blob([JSON.stringify(proj)], { type: 'application/json' }), 'clicker-project.json');
    store.set({ status: 'Project saved ✓' });
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
    const name = window.prompt('Project name', suggested);
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
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'vl-btn vl-btn--secondary ck-project-row';
      if (p.preview) {
        const img = document.createElement('img');
        img.className = 'ck-project-thumb';
        img.alt = '';
        // `asset:` is how a Tauri webview is allowed to read a file off disk.
        img.src = `asset://localhost/${encodeURIComponent(p.preview)}`;
        row.append(img);
      }
      const label = document.createElement('span');
      label.textContent = p.name;
      row.append(label);
      row.addEventListener('click', async () => {
        handle.close();
        try {
          const project = await host.loadProject(p.id);
          await applyProject(project.params);
          currentProjectId = project.id;
          store.set({ status: `Opened "${project.name}" ✓` });
        } catch (err) {
          store.set({ building: false, status: 'Could not open: ' + String(err) });
        }
      });
      list.append(row);
    }
  }

  async function loadProject(file: File) {
    try {
      await applyProject(JSON.parse(await file.text()));
    } catch (err) {
      store.set({ building: false, status: 'Could not load project: ' + String(err) });
    }
  }

  /** Applies a saved parameter blob to the live UI. Shared by both load paths. */
  async function applyProject(raw: unknown) {
    {
      store.set({ building: true, status: 'Loading project…' });
      const proj = raw as Record<string, any>;
      const set = proj.settings ?? {};

      currentText = set.currentText ?? 'Custom\nText';
      currentFontId = set.currentFontId ?? 'helvetiker-regular';
      currentSvgText = set.currentSvgText ?? '';
      currentSvgName = set.currentSvgName ?? '';
      currentIconText = set.currentIconText ?? '';
      currentIconName = set.currentIconName ?? '';

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
        tolerance: set.tolerance ?? store.get().tolerance,
        stemTolerance: set.stemTolerance ?? 0,
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
        edgeSettings: set.edgeSettings ?? store.get().edgeSettings,
        extrudeChamfer: set.extrudeChamfer ?? false,
        separateLetters: set.separateLetters ?? false,
        componentHeights: set.componentHeights ?? {},
      });

      if (set.importMode === 'image' && proj.image) {
        originalImage = await dataUrlToImage(proj.image);
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

  // ------------------------------------------------------- MakerLab handshake
  // MakerWorld build only: connect to the host when embedded (no-op otherwise). Runs alongside
  // boot(); the export buttons check mlReady() at click time, so ordering doesn't matter.
  if (MAKERLAB) {
    initMakerlab({
      onDisconnect: () => store.set({ status: 'Disconnected from the MakerLab host.' }),
    }).then((ctx) => {
      if (!ctx) return;
      console.log('[MakerLab] connected, capabilities:', (ctx as Record<string, unknown>).capabilities);
    });
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
