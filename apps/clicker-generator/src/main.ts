import '@vostok/ui-kit/styles.css';
import { topbarLinks } from '@vostok/ui-kit';
import './style.css';
import { createStore } from './store/store';
import { createViewer } from './viewer/viewer';
import { createUi, type UiState } from './ui/ui';
import { loadFileToImage, type RgbaImage } from './image/decode';
import { processImage } from './image/pipeline';
import { runWizard } from './ui/wizard';
import { downloadThreeMF } from './export/threemfExport';
import { parseSvg } from './image/logo';
import { SAMPLES, SVG_SAMPLES } from './image/sample';
import { parseLetter, importFontFile } from './image/letter';
import { LUCIDE_ICONS, buildSvg } from './image/lucideIcons';
import type {
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

// Mount unified Vostok topbar
const oldTopbar = document.getElementById('topbar');
if (oldTopbar) {
  oldTopbar.replaceWith(topbarLinks({
    githubUrl: 'https://github.com/vostoklabs/Clicker-Generator',
    boostUrl: 'https://makerworld.com/en/models/2980346',
  }));
}

// Start fetching switch assets immediately at startup to run in parallel with worker setup
const base = import.meta.env.BASE_URL;
const assetsPromise = Promise.all([
  fetch(base + 'assets/switch/mx/mx-socket.3mf').then((r) => r.arrayBuffer()),
  fetch(base + 'assets/switch/mx/mx-stem.3mf').then((r) => r.arrayBuffer()),
  fetch(base + 'assets/switch/mx/mx-switch.3mf').then((r) => r.arrayBuffer()),
]).catch((err) => {
  console.error('[assets] Pre-fetch failed:', err);
  throw err;
});

/** Which editable color a clicked model part maps back to. */
type ColorTarget = { kind: 'region'; index: number; compIndex: number } | { kind: 'body' } | { kind: 'base' };

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
  partOverrides: {},
  editMode: 'color',
  edgeSettings: [
    { target: 'capTop', style: 'chamfer', radius: 0.5 },
    // One control for the whole clicker base — bevels top + bottom body edges together.
    { target: 'clickerBase', style: 'chamfer', radius: 0.5 },
  ],
  extrudeChamfer: false,
  separateLetters: false,
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
const sidebarLeft = document.getElementById('sidebar-left')!;
const sidebarRight = document.getElementById('sidebar-right')!;
const statusEl = document.getElementById('status')!;
const viewer = createViewer(document.getElementById('app')!);

// ---- Apply initial theme (system pref or saved preference) ----
(function applyInitialTheme() {
  const saved = localStorage.getItem('clicker-theme');
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved ?? (systemDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
  viewer.setTheme(theme);
})();

const ui = createUi(sidebarLeft, sidebarRight, statusEl, {
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
  onExport: () => {
    if (!latestParts.length) return;
    downloadThreeMF(latestParts, 'clicker.3mf');
    // First download of the session → big license modal; later ones → quiet corner toast.
    // The counter is in-memory, so a page refresh re-shows the big modal on the next download.
    downloadCount += 1;
    if (downloadCount === 1) showLicenseModal();
    else showLicenseToast();
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
  onBodyColor: (hex) => {
    // Live recolor of the clicker body — no rebuild (geometry is unchanged).
    const idx = latestParts.findIndex((p) => p.name === 'base-body');
    if (idx >= 0) applyModelRecolor({ kind: 'body' }, hexToRgb(hex), idx);
    else store.set({ bodyColorRgb: hexToRgb(hex) });
  },

  onImportMode: (mode) => {
    const s = store.get();
    store.set({
      importMode: mode,
      baseShape: mode === 'text' ? 'outline' : s.baseShape,
      colorMode: mode !== 'image' ? 'normal' : s.colorMode,
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
    currentSvgText = svgText;
    currentSvgName = name;
    store.set({ status: `Selected SVG: ${name}. Click Generate to update.` });
  },
  onSelectIcon: (svgText, name) => {
    currentIconText = svgText;
    currentIconName = name;
    store.set({ currentIconName: name, status: `Selected icon: ${name}. Click Generate to update.` });
  },
  onTextChange: (text) => {
    currentText = text;
    store.set({ status: 'Text updated. Click Generate to update.' });
  },
  onFontSelect: (fontId) => {
    currentFontId = fontId;
    store.set({ status: 'Font changed. Click Generate to update.' });
  },
  onImportFont: async (file) => {
    try {
      store.set({ building: true, status: 'Importing font…' });
      const font = await importFontFile(file);
      ui.addFontOption(font);
      currentFontId = font.id;
      store.set({ building: false, status: `Font ${font.name} imported! Click Generate to update.` });
    } catch (err) {
      store.set({ building: false, status: 'Could not import font: ' + String(err) });
    }
  },
  onThemeChange: (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('clicker-theme', theme);
    viewer.setTheme(theme);
  },
  onGenerate: () => {
    reprocess();
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
window.addEventListener('keydown', (e) => {
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
});

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
    const prefix = `top-color-${i}-`;
    const overrides = s.partOverrides ? { ...s.partOverrides } : {};
    latestParts.forEach((p, idx) => {
      if (p.name.startsWith(prefix)) {
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
  } else if (target.kind === 'body') {
    viewer.setPartColor(partIndex, rgb);
    if (latestParts[partIndex]) latestParts[partIndex] = { ...latestParts[partIndex], colorRgb: rgb };
    store.set({ bodyColorRgb: rgb });
  } else {
    viewer.setPartColor(partIndex, rgb);
    if (latestParts[partIndex]) latestParts[partIndex] = { ...latestParts[partIndex], colorRgb: rgb };
    store.set({ baseColorOverride: rgb });
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
  const ink = dominantInk(s);
  return s.importMode === 'image' ? ink : contrastingFrame(ink);
}

// After a region recolor, repaint the frame part to match the derived color — live, no
// rebuild — so it never lags a frame behind the inlay it shares a color with.
function syncBaseColor() {
  const s = store.get();
  if (s.baseColorOverride || s.palette.length === 0) return;
  const baseRgb = deriveFrameColor(s);
  const bi = latestParts.findIndex((p) => p.name === 'top-base');
  if (bi >= 0) {
    latestParts[bi] = { ...latestParts[bi], colorRgb: baseRgb };
    viewer.setPartColor(bi, baseRgb);
  }
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
      viewer.setParts(msg.parts, !pendingHistoryReset);
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
    const [socket, stem, sw] = await assetsPromise;
    worker.postMessage({ type: 'init', socket, stem, switch: sw }, [socket, stem, sw]);
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
  // pinned frame color so it re-derives.
  pendingHistoryReset = true;
  store.set({ baseColorOverride: null });
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

  const palette: PaletteEntry[] = regionSet.regions.map((r, i) => ({
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

  const regions: BuildRegion[] = [];
  regionSet.regions.forEach((r, i) => {
    const baseColor = s.palette[i]?.filamentRgb ?? r.quantRgb;
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

  const isText = s.importMode === 'text';
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
  };

  if (quiet) {
    // Live edit preview (extrude / edges): rebuild silently — no full-screen overlay.
  } else if (isInitialLoad) {
    store.set({ status: 'Building clicker…' });
  } else {
    store.set({ building: true, status: 'Building clicker…' });
  }
  worker.postMessage({ type: 'buildClicker', regions, outline: regionSet.outline, params });
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
      <h2>Free for personal use 🎉</h2>
      <p>
        This generator and the designs it creates are released under a
        <a href="${LICENSE_URL}" target="_blank" rel="noopener noreferrer">CC BY-NC-ND 4.0 license</a>.
        Print as many as you like for yourself, completely free.
      </p>
      <div class="license-commercial">
        <div class="license-commercial-title">💰 Want to <span>sell</span> your prints?</div>
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
  downloadBlob(new Blob([JSON.stringify(proj)], { type: 'application/json' }), 'clicker-project.json');
  store.set({ status: 'Project saved ✓' });
}

async function loadProject(file: File) {
  try {
    store.set({ building: true, status: 'Loading project…' });
    const proj = JSON.parse(await file.text());
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
  } catch (err) {
    store.set({ building: false, status: 'Could not load project: ' + String(err) });
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
