import { BRAND } from '@vostok/brand';
import {
  button,
  type ButtonHandle,
  buttonRow,
  changelogButton,
  colorChip,
  dialog,
  helpTip,
  iconButton,
  modeBar,
  selectField,
  textareaField,
  thumbTile,
  toggleSwitch,
  type ValueRow,
  dpad,
  generatorHeader,
  ICONS,
  qualityCallout,
  segmentedControl,
  type SegmentedRow,
  setFieldOptions,
  sidebarFooter,
  sampleGrid,
  type SampleGridHandle,
  sliderRow,
  stepperRow,
  makeCollapsible,
  toast,
} from '@vostok/ui-kit';
import { MAKERLAB } from 'virtual:makerlab';
import type { BaseShapeKind, BlockOrientation, BlockSlot, KeychainSide, EditMode, EdgeSetting, EdgeStyle, KeychainParams, PaletteEntry, SwitchPlacement, ViewMode, RGB } from '../types';
import { FILAMENTS } from '../types';
import type { SectionAxis } from '../viewer/viewer';
import { SAMPLES } from '../image/sample';
import type { RgbaImage } from '../image/decode';
import type { FontOption } from '../image/letter';
import { FONT_OPTIONS, loadBundledFonts } from '../image/letter';
import { LUCIDE_ICONS, buildSvg, svgDataUrl } from '../image/lucideIcons';
import { CHANGELOG } from '../changelog';
import { entryForState, loadPackShapes } from '../shapes/directory';
import { designUrl, inSeason, loadDesignImage, orderedDesignPacks } from '../packs';
import { openShapePicker } from './shapePicker';

/** Fallback swatch for the keycap row before the build derives a contrasting frame. */
const DEFAULT_CAP_RGB: RGB = [240, 240, 240];

export interface UiState {
  status: string;
  building: boolean;
  hasParts: boolean;
  /** Name of whichever sample or pack design tile is the one currently loaded — the same
   *  string `onSample`'s `label` carried into the status line, and what `sampleGrid`'s items
   *  are keyed by, so no separate id needs inventing on either side. Null once an upload
   *  replaces it — the loaded picture is then the user's own, not any tile's (audit #2: the
   *  loaded sample had no visible mark at all). */
  loadedSampleId: string | null;
  colorCount: number;
  palette: PaletteEntry[];
  baseShape: BaseShapeKind;
  capWidthMm: number;
  topThickness: number;
  imageDepth: number;
  /** How far the cap stands proud of the body border at rest, mm. */
  capProud: number;
  /** Hollow the body's underside instead of printing it solid. */
  hollowBase: boolean;
  /** Lock the finished base to this outer size (mm), fitting the design inside it. Null =
   *  the base follows the design, which is what the generator has always done. */
  fixedSize: { w: number; h: number } | null;
  /** How much of the room inside the frame the artwork takes, 0.3-1. 1 = fills it. */
  designScale: number;
  /** The "detail" knob of whichever parametric shape is selected — sides, points or teeth.
   *  One field because the shapes are mutually exclusive. */
  shapeSides: number;
  /** Corner radius for the shapes that have corners, as a percentage of the short side. */
  shapeCornerPct: number;
  /** The notch knob: a star's valley radius, a cross's arm half-width. Same one-field logic
   *  as `shapeSides` — the shapes that have a notch are mutually exclusive. */
  shapeArmPct: number;
  /** Which seasonal-pack shape the base is using, as `packId:shapeId`. Null unless
   *  `baseShape` is 'custom'. Stored in projects, so it is the token and not an index. */
  packShapeToken: string | null;
  /** Which DRAWN outline the base is using, as an opaque id. Null unless the shape came out of
   *  the 2-D editor with points the user moved.
   *
   *  An id rather than the points themselves, for two reasons that pull the same way: every
   *  `store.set` is a full object spread and a drawn ring is a few hundred numbers, and the
   *  undo history is a JSON snapshot of these fields — so the points would be copied into
   *  memory sixty times over. The id is in the history and the points are in a map beside it,
   *  which is what makes undo across two different drawn shapes come back with the right one. */
  drawnShapeId: string | null;
  /** Outer size of the base the LAST build produced, mm. Read-only: it comes back from the
   *  geometry, not from a control. It is what "Lock the base size" seeds itself from, so
   *  turning the lock on never moves the model — a lock that resized the thing you were
   *  looking at would read as a bug, and it is also the number people ask for when they say
   *  "how big is this actually". */
  builtBodyMm: { w: number; h: number } | null;
  /** Top ↔ base slip-fit clearance, mm. Baseline 0.4 reads as a 0 offset in the UI. */
  tolerance: number;
  /** Cap stem fit, % of the cross socket that grips the switch. 0 = the asset as authored. */
  stemFitPct: number;
  /** Body switch-pocket fit, % of the socket footprint. 0 = the asset as authored. */
  socketFitPct: number;
  /** MX switch placements (1..3): each x/y offset (mm) + rotation (deg) from centre. */
  switches: SwitchPlacement[];
  /** Which switch the d-pad drives (0-based). */
  activeSwitchIndex: number;
  smoothing: number;
  keychain: KeychainParams;
  removeBg: boolean;
  view: ViewMode;
  showSwitch: boolean;
  /** 'blocks' = the letter-block chain (one block + switch + keycap per letter). */
  importMode: 'image' | 'svg' | 'icon' | 'text' | 'blocks';
  currentIconName: string;
  colorMode: 'normal' | 'limited';
  limitedColors: RGB[];
  bodyColorRgb: RGB;
  paletteOverrides: RGB[];
  /** Explicit cap-backing/frame color set by clicking it on the model (else derived). */
  baseColorOverride: RGB | null;
  /** Nudge of the design within a preset base shape, mm. */
  imageOffset: { x: number; y: number };
  /** Component-specific overrides (key: 'top-color-{colorIndex}-{compIndex}') */
  partOverrides: Record<string, RGB>;
  /** Colours picked by hand for this design that are not on the filament shelf. Once used
   *  anywhere they are offered as swatches everywhere, so the second element can get the
   *  same colour as the first without the colour wheel. */
  customColors: RGB[];
  /** Current edit mode for the 3D viewport. */
  editMode: EditMode;
  /** Edge modification settings (fillet / chamfer). */
  edgeSettings: EdgeSetting[];
  /** Global toggle: chamfer every raised (extruded) color part. Not tied to selection. */
  extrudeChamfer: boolean;
  /** Text mode: when true each letter is its own selectable/colorable part. Default false. */
  separateLetters: boolean;
  /** Text mode typography: multiplier on the line gap (1 = default). */
  lineSpacing: number;
  /** Text mode typography: tracking between glyphs, fraction of the em (0 = the font's own). */
  letterSpacing: number;
  /** Text mode typography: glyph outline offset in mm — "boldness". */
  textBold: number;
  /** Text mode: how big the letters print, 1 = the default fit. Grows the clicker rather
   *  than shrinking anything else — see the sizing note in `buildParamsFor`. */
  textScale: number;
  /** Text mode: how much spacing has grown the word past its default layout (1 = none).
   *  Multiplies the Size so the clicker grows and the letters keep their size. */
  textSizeMul: number;
  // ---- Letter blocks (importMode 'blocks') ----
  /** The chain, in order: one entry per printed block (a letter or a symbol). */
  blockSlots: BlockSlot[];
  /** Row (reads left→right) or column (top→bottom). */
  blockOrientation: BlockOrientation;
  /** Legend size multiplier on the keycap (1 = default fit). */
  legendScale: number;
  /** Legend outline offset in mm — "boldness". */
  legendBold: number;
  /** Which side of the block set the keyring loop hangs off. */
  keychainEnd: KeychainSide;
  /** How far the loop has been slid along that side, mm. 0 = where it has always sat. */
  keychainSlideMm: number;
  /** Current extrude height being dragged (for HUD display), null when not dragging. */
  extrudeHeight: number | null;
  /** Component-specific heights */
  componentHeights: Record<string, number>;
  /** Which parts are currently selected in the viewport (part names). */
  selectedParts: string[];
  /** Whether an undo / redo step is available (drives the toolbar buttons). */
  canUndo: boolean;
  canRedo: boolean;
  canRefresh: boolean;
}

export interface UiCallbacks {
  onUpload(file: File): void;
  /** `label` is the sample or pack design's own name (`s.name` / `design.name`) — the only way
   *  `mount.ts` can put a real name in the "Sample: X" status without reference-matching a
   *  closure back to the bundled gallery, which a pack design's `() => loadDesignImage(...)`
   *  closure can never match. */
  onSample(load: () => Promise<RgbaImage>, label?: string): void;
  /** Reopen the prepare-image wizard on the picture that is loaded. */
  onAdjustImage(): void;
  /** A colour picked from the wheel, once the popover closes — the one moment a new colour
   *  has actually been chosen rather than dragged through. */
  onCustomColor(hex: string): void;
  onColorCount(n: number): void;
  onSmoothing(v: number): void;
  onFilament(index: number, hex: string): void;
  /** Put every individually recolored shape back on its palette row. */
  onResetPartColors(): void;
  onShape(kind: BaseShapeKind): void;
  onWidth(mm: number): void;
  onTopThickness(mm: number): void;
  onImageDepth(mm: number): void;
  /** Button height above the bezel at rest, mm. */
  onCapProud(mm: number): void;
  /** Hollow the body's underside. */
  onHollowBase(on: boolean): void;
  /** Lock the base to a size, or let it follow the design again (null). */
  onFixedSize(size: { w: number; h: number } | null): void;
  /** Artwork size as a fraction of the room inside the frame (0.3-1). */
  onDesignScale(v: number): void;
  /** Pick a base shape from the directory, by its `ShapeEntry` id. */
  onShapePick(id: string): void;
  /* The three knobs of whichever parametric shape is picked.

     They are back as their own callbacks after a spell of being reachable only as grips on
     the editor's canvas. The grips stay; what they could not do is be found — only two of
     the fifteen shapes have a count grip at all, so on the other thirteen the answer to
     "how do I change the sides" was silence. These fire from the picker, beside the shape. */
  onShapeSides(n: number): void;
  onShapeCorner(pct: number): void;
  onShapeArm(pct: number): void;
  /** Open the 2-D shape editor — changing a shape, or drawing one. CHOOSING one is the
   *  picker's job (`onShapePick`), which is a drawer rather than a modal. */
  onEditShape(): void;
  /** Export the printable stem fit test. */
  onFitTest(): void;
  /** Top ↔ base slip fit, absolute mm (+ looser, − tighter). */
  onGapTolerance(mm: number): void;
  /** Cap stem fit, absolute % of the cross socket (+ looser, − tighter grip). */
  onStemFit(pct: number): void;
  /** Body switch-pocket fit, absolute % of the socket footprint (+ looser, − tighter). */
  onSocketFit(pct: number): void;
  /** Nudge the active switch by a step (mm). +dx = right, +dy = toward the design's top. */
  onSwitchNudge(dx: number, dy: number): void;
  /** Rotate the active switch by a step (degrees, + = clockwise / right). */
  onSwitchRotate(deltaDeg: number): void;
  /** Recenter (and unrotate) the active switch to its default slot. */
  onSwitchReset(): void;
  /** Set the number of switches (1..3); replaces the layout with symmetric defaults. */
  onSwitchCount(n: number): void;
  /** Select which switch the d-pad drives (0-based). */
  onActiveSwitch(i: number): void;
  /** Reset every switch to the default layout. */
  onSwitchResetAll(): void;
  onKeychainToggle(on: boolean): void;
  /** Set the keychain attachment's bearing around the body edge, absolute degrees (90 = top). */
  onKeychainAngle(deg: number): void;
  /** Change the keychain ring hole diameter by delta mm. */
  onKeychainSize(deltaMm: number): void;
  /** Set the keychain attachment's fine offset along the body edge tangent, absolute mm. */
  onKeychainOffsetSet(mm: number): void;
  /** Put the keyring loop back at the top of the body. */
  onKeychainReset(): void;
  onRemoveBg(on: boolean): void;
  onView(mode: ViewMode): void;
  onShowSwitch(on: boolean): void;
  onSection(axis: SectionAxis, pos: number): void;
  onExport(): void;
  onRenderPng(): void;
  onAiPrompt(): void;
  onSaveProject(): void;
  onLoadProject(file: File): void;
  /**
   * Open a stored project, when there is a host that stores them.
   *
   * On the desktop the kit's Load button hands us no file and expects the host's own picker
   * to be opened instead — there is no file input in that story. Optional, so the web build
   * simply does not provide it and keeps the file-input path.
   */
  onOpenFromHost?(): void;
  /**
   * The host draws Save and Open itself, so the sidebar footer must not.
   *
   * Passed in rather than read off a flag here, because the UI has no host to ask and the
   * question is about the host's capability rather than about being on a desktop at all.
   */
  hostOwnsProjects?: boolean;
  /**
   * Ask the host for a file, when it has a library to offer.
   *
   * Returns null and does nothing when there is no host, which is the signal to fall
   * through to the hidden file input this UI already owns. One hook rather than a `host`
   * reference, because the UI has no business knowing what a host is.
   */
  pickFile?(kind: string, extensions: string[]): Promise<File | null>;
  onBodyColor(hex: string): void;

  // New callbacks for vector modes
  onImportMode(mode: UiState['importMode']): void;
  onSvgUpload(file: File): void;
  onSelectSvg(svgText: string, name: string): void;
  onSelectIcon(svgText: string, name: string): void;
  onTextChange(text: string): void;
  onFontSelect(fontId: string): void;
  onImportFont(file: File): void;
  onThemeChange(theme: string): void;
  onEditMode(mode: EditMode): void;
  onEdgeStyle(target: string, style: EdgeStyle): void;
  onEdgeStep(target: string, delta: number): void;
  onExtrudeStep(delta: number): void;
  /** Global toggle: chamfer every raised (extruded) part. Not tied to selection. */
  onExtrudeChamfer(on: boolean): void;
  /** Text mode: toggle splitting the word into per-letter parts. */
  onSeparateLetters(on: boolean): void;
  onLineSpacing(v: number): void;
  onLetterSpacing(v: number): void;
  onTextBold(mm: number): void;
  onTextScale(v: number): void;
  /** Slide the design inside a preset base shape by dx/dy mm. */
  onImageNudge(dx: number, dy: number): void;
  onImageNudgeReset(): void;
  // ---- Letter blocks ----
  /** The whole chain changed (a chip was added or removed). */
  onBlockSlots(slots: BlockSlot[]): void;
  /** The blocks text box changed — retype the letter chips, keep the symbols. */
  onBlockText(text: string): void;
  onBlockOrientation(o: BlockOrientation): void;
  onLegendScale(v: number): void;
  onLegendBold(mm: number): void;
  /** Keycap colour (shared by every cap in the chain). */
  onCapColor(hex: string): void;
  onKeychainEnd(side: KeychainSide): void;
  /** Set how far the block-set keyring loop sits along its side, absolute mm. */
  onKeychainSlideSet(mm: number): void;
  /** Put the loop back to the middle of its side. */
  onKeychainSlideReset(): void;
  onUndo(): void;
  onRedo(): void;
  onRefresh(): void;
  /** Report something the user should see in the status line — e.g. a dropped file this app
   *  cannot use. Not a rebuild trigger; just text. */
  onStatus(text: string): void;
}

/** The symbols worth putting on a keycap: cute, playful, instantly readable at 11 mm.
 *  These lead the block symbol picker (search still reaches the full Lucide set). */
const BLOCK_SYMBOLS = [
  'heart', 'star', 'sun', 'moon', 'cloud', 'flower', 'flower-2', 'leaf', 'sprout',
  'smile', 'laugh', 'ghost', 'cat', 'dog', 'bird', 'fish', 'bug', 'paw-print',
  'rocket', 'gamepad-2', 'music', 'headphones', 'camera', 'palette', 'brush',
  'crown', 'trophy', 'gift', 'cake', 'coffee', 'pizza', 'ice-cream-cone',
  'zap', 'flame', 'snowflake', 'droplet', 'rainbow', 'sparkles',
  'anchor', 'plane', 'car', 'bike', 'tent', 'mountain', 'umbrella',
  'check', 'x', 'plus', 'minus', 'arrow-up', 'arrow-down', 'arrow-left', 'arrow-right',
  'thumbs-up', 'hand', 'key', 'lock', 'bell', 'clock', 'map-pin', 'lightbulb',
];

const POPULAR_LUCIDE = [
  // File & clipboard
  'copy', 'clipboard', 'clipboard-paste', 'scissors', 'trash-2', 'save',
  'file', 'files', 'folder', 'folder-open', 'archive', 'download', 'upload',
  // Edit
  'undo-2', 'redo-2', 'search', 'replace', 'eraser', 'pencil', 'type',
  'bold', 'italic', 'underline',
  // Navigation
  'home', 'arrow-up', 'arrow-down', 'arrow-left', 'arrow-right',
  'corner-down-left', 'chevron-up', 'chevron-down',
  // Keys & input
  'keyboard', 'mouse', 'command', 'delete',
  // Media
  'play', 'pause', 'skip-back', 'skip-forward', 'volume-2', 'volume-x',
  'mic', 'mic-off', 'music', 'headphones',
  // Display / system
  'sun', 'moon', 'monitor', 'lock', 'unlock', 'eye', 'eye-off',
  'power', 'wifi', 'bluetooth', 'battery',
  // Apps
  'terminal', 'code', 'settings', 'bell', 'calendar', 'mail',
  'message-circle', 'phone', 'camera', 'image',
  // Symbols & fun
  'star', 'heart', 'circle', 'bookmark', 'flag', 'check', 'x', 'plus', 'minus',
  'refresh-cw', 'rotate-cw', 'flame', 'zap', 'rocket', 'ghost', 'skull',
  'coffee', 'gamepad-2', 'trophy', 'crown',
];

/** The fixed 2-12 color-count choices. `update()` layers a synthetic "N Colors (Limited)"
 *  entry on top of these through `setFieldOptions()` when the model's palette is capped. */
const COLOR_COUNT_OPTIONS = Array.from({ length: 11 }, (_, i) => {
  const n = i + 2;
  return { value: String(n), label: `${n} Colors` };
});

const rgbHex = (rgb: [number, number, number]) =>
  '#' + rgb.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');

const hexRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

// Friendly label for an edge target (global edge, body, cap frame, or a color part).
const friendlyTargetLabel = (t: string): string => {
  if (t === 'capTop') return 'Cap Top';
  if (t === 'baseTop') return 'Base Top';
  if (t === 'baseBottom') return 'Base Bottom';
  if (t === 'base-body') return 'Body';
  if (t === 'top-base') return 'Cap Frame';
  const m = /^top-color-(\d+)-\d+$/.exec(t);
  if (m) return `Color ${+m[1] + 1}`;
  return t;
};

/** Whether the base reads as an outline. Icon line-art makes a broken outline body, so
 *  an icon design is always a solid shape whatever `baseShape` says. */
const isOutlineBase = (s: Pick<UiState, 'baseShape' | 'importMode'>) =>
  s.baseShape === 'outline' && s.importMode !== 'icon';

export function createUi(
  sidebarLeft: HTMLElement,
  sidebarRight: HTMLElement,
  statusEl: HTMLElement,
  cb: UiCallbacks,
  /** The state the store was created with. Every control below seeds its starting
   *  value from this instead of restating it, so the two cannot drift apart. */
  initial: UiState
) {
  /**
   * Everything this UI attaches outside the two sidebars it was handed.
   *
   * A browser tab never had to undo any of it. A desktop host does: the tooltip bubble, the
   * modals and the popovers all live on <body>, and the drag-and-drop and hover handlers
   * live on `window` and `document`. None of them is inside an element the host can clear,
   * so each one has to be given back explicitly. `dispose()` on the returned object is what
   * runs them.
   */
  const cleanups: (() => void)[] = [];

  /** Neutral top-to-base clearance (mm): the tolerance the store starts at, so the
   *  "Top / base gap" stepper reads a 0 offset on a fresh design. */
  const BASE_SOCKET_TOL = initial.tolerance;

  /* Two toggles live on panels that float over the viewport rather than in a sidebar, so
     they are built further down but read by the sync pass at the bottom. */
  let undoBtn: ButtonHandle;
  let refreshBtn: ButtonHandle;
  let redoBtn: ButtonHandle;
  let editModes: ReturnType<typeof modeBar<EditMode>> | null = null;
  let separateLettersToggle: ValueRow<boolean> | null = null;
  let extrudeChamferToggle: ValueRow<boolean> | null = null;
  let extrudeLevelRow: ValueRow<number> | null = null;
  /** What the Level stepper last reported, so its absolute readout can be turned back into
   *  the delta `onExtrudeStep` actually wants — see where it is built, below. */
  let extrudeLevelLast = 0;

  /** Signed millimetre offset, for a control whose 0 is a baseline rather than zero. */
  const fmtSignedMm = (v: number, dec: number) =>
    (v > 0.0001 ? '+' : v < -0.0001 ? '−' : '') + Math.abs(v).toFixed(dec) + ' mm';

  /* A hand-rolled "?" marker duplicating the kit's `helpTip()` — same bubble, but this one
     put `role="img"` on something with `tabindex="0"` and a hover/focus handler, which is not
     an image, and its bubble was one `<div>` shared by every marker on the page rather than
     the kit's per-marker, fixed-positioned one. Both sections here are built from a template
     literal (a big `.innerHTML =` string), so `tip()` cannot return a live `helpTip()` element
     directly — it drops a placeholder, and `resolveHelpTips()` below swaps every one for a
     real `helpTip()` once the HTML lands in the DOM. */
  const tip = (text: string) =>
    `<span class="js-help-placeholder" hidden data-help="${text.replace(/"/g, '&quot;')}"></span>`;

  /** Swap every `tip()` placeholder under `root` for a real kit `helpTip()`. Call once, right
   *  after the `.innerHTML` that contains them is assigned. */
  const resolveHelpTips = (root: ParentNode) => {
    for (const marker of root.querySelectorAll('.js-help-placeholder')) {
      const text = (marker as HTMLElement).dataset.help ?? '';
      marker.replaceWith(helpTip(text));
    }
  };

  const headerEl = generatorHeader({
    title: 'Clicker Generator',
    description: 'Generate printable 3D model of a clicker from an image',
  });

  // The quality callout links to an external MakerWorld page — suppress when embedded
  // in MakerLab (the link won't work in the sandboxed iframe).
  const qualityEl = MAKERLAB ? null : qualityCallout({
    html: `For the best quality printed clicker, please use the print profile and instructions available on <a class="hint-link" href="${BRAND.urls.clickerListing}" target="_blank" rel="noopener">MakerWorld</a>.`,
    storageKey: 'clicker-quality-callout',
  });

  // Populate Left Sidebar (Settings + Preview). The controls go into their own scrolling
  // body — mirroring the right sidebar — so the MakerLab credit block can pin to the
  // bottom-left corner instead of scrolling away with the controls (see below).
  //
  // `#proMount` near the bottom is an anchor and nothing else: in the MakerWorld build
  // mount.ts fills it, and in every other build it stays an empty div. The explanation lives
  // here rather than as an HTML comment inside the string, because a comment in a template
  // literal survives minification verbatim — the first version of it shipped the name of an
  // unreleased feature into the public bundle's DOM.
  const leftScroll = document.createElement('div');
  leftScroll.className = 'vl-panel__scroll';
  leftScroll.innerHTML = `
    <div class="section" id="previewViewSection">
      <span class="label">Preview &amp; view</span>
      <div id="viewTabsMount" style="margin-bottom: 12px;"></div>
      <div id="showSwitchMount"></div>
    </div>

    <!-- Letter blocks: the shape controls for the chain live here, next to the preview,
         because the right panel is for WHAT is on the blocks (text, chips, font). -->
    <div class="section" id="blocksSection" hidden>
      <span class="label">Blocks</span>
      <div class="field">
        <label>Layout ${tip('A row reading left to right, or a column reading top to bottom.')}</label>
        <div id="blockOrientMount"></div>
      </div>
      <div class="prow-stacked">
        <div id="legendSizeMount"></div>
      </div>
      <div class="prow-stacked">
        <div id="legendBoldMount"></div>
      </div>
    </div>

    <!-- Text mode: typography sits here for the same reason the blocks controls do —
         the right panel is WHAT the text is (the words, the font); this is how it is set. -->
    <div class="section" id="textSection" hidden>
      <span class="label">Text</span>
      <div class="prow-stacked"><div id="textScaleMount"></div></div>
      <div class="prow-stacked"><div id="textBoldMount"></div></div>
      <div class="prow-stacked"><div id="letterSpacingMount"></div></div>
      <div class="prow-stacked"><div id="lineSpacingMount"></div></div>
    </div>

    <div class="section" id="baseStyleSection">
      <span class="label">Base style ${tip('Outline follows your image silhouette. Shape places the image on a preset base such as a circle or square.')}</span>
      <div class="field">
        <div id="shapeTypeTabsMount" style="margin-bottom: 12px;"></div>
      </div>
      <div class="field" id="shapeSelectField" style="margin-bottom: 12px;">
        <label>Base shape ${tip('The shape of the printed base. Open the editor to pick one and change it — the handles sit on the shape itself.')}</label>
        <div id="shapePickMount"></div>
      </div>
      <!-- The two sliders that used to live here (sides, corner radius) are gone. They asked
           about the shape in a place the shape was not, which is what "points slider is just
           dumb" meant; both are grips on the outline in the editor now. -->
      <div class="prow-stacked">
        <div id="widthMount"></div>
      </div>
      <div class="prow-stacked"><div id="designScaleMount"></div></div>
      <div class="prow-stacked"><div id="fixedSizeMount"></div></div>
      <div id="fixedSizeFields" hidden>
        <div class="prow-stacked"><div id="fixedWMount"></div></div>
        <div class="prow-stacked"><div id="fixedHMount"></div></div>
        <div id="fixedSizePresetMount"></div>
      </div>
      <div class="field" id="imageNudgeField" style="display:none;">
        <label>Move design ${tip('Slide the artwork around inside the base shape. The base keeps its size; anything pushed past the frame is cropped.')}</label>
        <div id="imageNudgePadMount"></div>
      </div>
    </div>

    <div id="geometrySettingsContainer">
      <details class="vl-section vl-section--collapsible" id="sectionBodyFit">
        <summary>Body &amp; fit</summary>
        <div class="vl-section__body">
        <div class="prow-stacked">
          <div id="topthickMount"></div>
        </div>
        <div class="prow-stacked">
          <div id="imgdepthMount"></div>
        </div>
        <div class="prow-stacked">
          <div id="capProudMount"></div>
        </div>
        <div class="prow-stacked"><div id="hollowMount"></div></div>
        <!-- The three fit controls. They are three because they are three different pairs of
             surfaces, and the old two were named after parts they did not touch. -->
        <div class="prow-stacked"><div id="gapTolMount"></div></div>
        <div class="prow-stacked"><div id="stemFitMount"></div></div>
        <div class="prow-stacked"><div id="socketFitMount"></div></div>
        <div class="prow-stacked">
          <p class="switch-pad-hint">Print the test below, try each tile on a real switch, then type the number that fits the stem and pocket sliders above.</p>
          <div id="fitTestMount"></div>
        </div>
        </div>
      </details>

      <details class="vl-section vl-section--collapsible" id="sectionSwitch">
        <summary>Switch</summary>
        <div class="vl-section__body">
        <div class="field" style="margin-bottom:10px;">
          <label>Switches ${tip('Use 1 to 3 MX switches for larger or wider designs, for more click points and stability. Each switch can be moved and rotated individually.')}</label>
          <div id="switchCountMount"></div>
        </div>
        <div id="switchChipsMount" style="display:none; margin-bottom:10px;"></div>
        <p class="switch-pad-hint">Move &amp; rotate the MX switch ${tip('Slide and rotate the selected MX switch away from the design centre. Handy when a switch doesn\'t sit neatly in the centre of your design.')}</p>
        <div id="switchPadMount"></div>
        <button class="secondary" id="switchResetAll" type="button" style="display:none; width:100%; margin-top:8px;">Reset all switches</button>
        </div>
      </details>

      <!-- Pushed below Switch (was right after Base style): with per-shape recolor moved
           into the 3D view, this section is now mostly the count and the reset-all-recolors
           escape hatch — Ian's read was "since we can more easily colour things in the
           preview window, push colours much further down the list". -->
      <details class="vl-section vl-section--collapsible" id="sectionColors">
        <summary>Colors</summary>
        <div class="vl-section__body">
        <div class="field" id="colorCountField">
          <div id="ccountMount"></div>
          <p class="vl-hint">Most AMS units hold 4 filaments; more colors means manual swaps.</p>
        </div>
        <div class="prow-stacked" id="smoothingField">
          <div id="smoothMount"></div>
        </div>
        <div class="palette" id="palette">
          <div class="hint">Load an image/vector to pick colors.</div>
        </div>
        </div>
      </details>

      <details class="vl-section vl-section--collapsible" id="sectionKeychain">
        <summary>Keychain</summary>
        <div class="vl-section__body">
        <div id="keychainMount" style="margin-bottom: 12px;"></div>
        <div id="keychainOpts" style="display:none;">
          <!-- Free-form body: an absolute angle round the edge, a fine offset along it, and
               a way back to the default — replacing the d-pad whose arrows moved the loop in
               directions that did not match what they pointed at (audit: keychain controls). -->
          <div class="prow-stacked" id="keychainAngleRow">
            <div id="keychainAngleMount"></div>
          </div>
          <div class="prow-stacked" id="keychainOffsetRow">
            <div id="keychainOffsetMount"></div>
          </div>
          <div id="keychainFreeResetMount" style="margin-bottom: 12px;"></div>

          <!-- Letter blocks: the loop welds onto an end block's outer face, so the choice is
               which side it hangs from and how far along that side it sits. -->
          <div class="field" id="keychainEndField" style="display:none;">
            <div id="keychainEndMount"></div>
          </div>
          <div class="prow-stacked" id="keychainSlideRow" style="display:none;">
            <div id="keychainSlideMount"></div>
          </div>
          <div id="keychainBlockResetMount" style="display:none; margin-bottom: 12px;"></div>

          <div class="prow-stacked"><div id="keychainSizeMount"></div></div>
        </div>
        </div>
      </details>

      <!-- The Updates drawer, under the last section rather than in the sticky footer: it is
           read once in a while, and should not compete with the controls that are on screen
           the whole time. Same placement as the fold-up box generator. -->
      <div id="proMount"></div>

      <div id="updatesMount"></div>
    </div>

    <div class="sidebar-sticky-footer">
      <div id="historyControls"></div>
    </div>
  `;

  resolveHelpTips(leftScroll);

  sidebarLeft.innerHTML = '';
  sidebarLeft.append(leftScroll);

  if (MAKERLAB) {
    // MakerWorld review feedback (2026-07-27): the Vostok Labs intro block is the most
    // prominent thing in the embed on first load, and the host would rather off-platform
    // promotion not sit in that spot. In the MakerLab build it moves to the BOTTOM-LEFT
    // — pinned below the scroll area — and is demoted to a compact muted credit line
    // (.kc-credit-block in style.css). The host page already shows the app's name, so
    // the top-of-sidebar heading isn't needed here. Public build keeps it up top.
    headerEl.classList.add('kc-credit-block');
    sidebarLeft.append(headerEl);
  } else {
    leftScroll.prepend(...(qualityEl ? [headerEl, qualityEl] : [headerEl]));
  }

  // Populate Right Sidebar (Input Modes & Export)
  sidebarRight.innerHTML = '';
  const rightScroll = document.createElement('div');
  rightScroll.className = 'vl-panel__scroll';
  rightScroll.innerHTML = `
    <div class="section" id="importSourceSection">
      <span class="label">Import source ${tip('Switch between raster image, SVG vector, built-in icon, or custom text to create your clicker.')}</span>
      <div id="importTabsMount" style="margin-bottom: 16px;"></div>

      <!-- Image Panel -->
      <div id="imagePanel" class="mode-panel">
        <div class="drop" id="drop" role="button" tabindex="0" aria-label="Upload image. Drop a file here, or activate to browse.">
          <svg class="drop-icon" xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <div class="drop-title">Upload image</div>
          <div class="drop-text">Drop an image, or <u>click to browse</u></div>
          <span style="font-size:10px; opacity:0.8; display:block; margin-top:4px;">PNG with transparency works best</span>
        </div>
        <input type="file" id="file" accept="image/*" hidden />
        <div id="adjustImageMount"></div>
        <div id="removeBgMount"></div>
        <div id="sampleGridMount"></div>
      </div>

      <!-- SVG Panel -->
      <div id="svgPanel" class="mode-panel" hidden>
        <p class="hint-text">
          Drop or upload SVG vector files. Color paths will map to filament slots.
        </p>
        <div id="uploadGallery"></div>
        <label class="upload-cta">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          Upload SVG file(s)
          <input id="svgUpload" type="file" accept=".svg,image/svg+xml" multiple />
        </label>
        <div id="removeBgSvgMount"></div>
      </div>

      <!-- Icon Panel -->
      <div id="iconPanel" class="mode-panel" hidden>
        <div id="iconSearchWrap">
          <input id="iconSearch" type="search" placeholder="Search Lucide icons…" autocomplete="off" spellcheck="false" />
          <button id="iconSearchClear" type="button" aria-label="Clear search">×</button>
        </div>
        <div id="iconCount"></div>
        <div id="gallery"></div>
      </div>

      <!-- Text / Blocks Panel (shared: both modes are driven by text + a font) -->
      <div id="letterPanel" class="mode-panel" hidden>
        <div id="textOnlyField"></div>

        <!-- Blocks-only: the chain, one chip per printed block -->
        <div id="blocksTextField" hidden></div>
        <div class="field" id="blocksChainField" hidden>
          <label>Add symbol or emoji ${tip('One chip is one printed block. Click a chip to change its letter or swap in a symbol; the small + between chips drops a symbol anywhere in the row.')}</label>
          <p class="hint-text" style="margin: 0 0 6px;">
            Press + between two blocks to add a symbol there, or click a block to change it.
          </p>
          <div id="blockChips" class="block-chips"></div>
        </div>
        ${MAKERLAB ? '' : `<p class="hint-text" id="blocksKeycapLink" hidden>
          Want more keycap options, like profiles, sizes, or your own SVG or photo on the
          cap? Use the <a class="hint-link" href="${BRAND.urls.keycapApp}" target="_blank" rel="noopener">Vostok Labs Keycap Generator</a>.
        </p>`}
        <div class="field">
          <label>Font</label>
          <div id="fontGrid" class="font-grid"></div>
          <label class="upload">
            + Import font
            <input id="fontUpload" type="file" accept=".ttf,.otf,.json,font/ttf,font/otf,application/json" />
          </label>
        </div>

      </div>
    </div>
  `;
  resolveHelpTips(rightScroll);

  // Hidden dummy file input for loading project JSON
  const projFileInput = document.createElement('input');
  projFileInput.type = 'file';
  projFileInput.id = 'projFile';
  projFileInput.accept = 'application/json';
  projFileInput.hidden = true;
  rightScroll.appendChild(projFileInput);

  const rightFooter = sidebarFooter({
    hostOwnsProjects: cb.hostOwnsProjects,
    formats: [{ id: '3mf', label: '3MF' }],
    onExport: () => cb.onExport(),
    onSave: () => cb.onSaveProject(),
    onLoad: (f?: File) => {
      if (!f) { cb.onOpenFromHost?.(); return; }
      // Forward the picked file to the hidden project-file input, whose change
      // handler (below) calls cb.onLoadProject.
      const dt = new DataTransfer();
      dt.items.add(f);
      projFileInput.files = dt.files;
      projFileInput.dispatchEvent(new Event('change', { bubbles: true }));
    },
    themeStorageKey: 'clicker_theme',
  });

  if (MAKERLAB) {
    rightFooter.querySelector('.vl-action-row')?.remove();
  }

  // Wrapper the Raise/Edges panels dock into (see their construction below): a
  // `position: relative` box around just the scroll area, so a docked panel can cover it
  // exactly (`position: absolute; inset: 0`) without also covering `rightFooter` — the
  // export button has to stay reachable while a panel is open. Takes over the flex slot
  // `rightScroll` used to hold directly in `.vl-panel--right`; `rightScroll` still owns its
  // own scrolling underneath.
  const rightScrollWrap = document.createElement('div');
  rightScrollWrap.className = 'right-scroll-wrap';
  rightScrollWrap.appendChild(rightScroll);

  sidebarRight.append(rightScrollWrap, rightFooter);

  // Global ID helper
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

  // Quality callout dismiss
  try {
    if (localStorage.getItem('clicker-quality-callout') === 'dismissed') {
      $('clickerQualityCallout')?.remove();
    }
  } catch {}
  $('clickerQualityDismiss')?.addEventListener('click', () => {
    try { localStorage.setItem('clicker-quality-callout', 'dismissed'); } catch {}
    $('clickerQualityCallout')?.remove();
  });

  // --- History bindings ---
  // Three, in one row. They used to be hand-built `<button class="secondary">` inside
  // `.btn-row`, which is a TWO-column grid — so the third wrapped onto its own line and sat
  // there looking like a mistake. `.vl-btn-row` is flex, so the count lives in the markup
  // rather than in a CSS column template that has to be kept in step with it.
  undoBtn = iconButton({ icon: ICONS.undo, label: 'Undo (Ctrl+Z)', emphasis: 'secondary', disabled: true, onClick: () => cb.onUndo() });
  refreshBtn = iconButton({ icon: ICONS.rotateRight, label: 'Refresh to original', emphasis: 'secondary', disabled: true, onClick: () => cb.onRefresh() });
  redoBtn = iconButton({ icon: ICONS.redo, label: 'Redo (Ctrl+Shift+Z)', emphasis: 'secondary', disabled: true, onClick: () => cb.onRedo() });
  $('historyControls').append(buttonRow(undoBtn, refreshBtn, redoBtn));

  /** The host's library if there is one, the hidden input if there is not. */
  async function pickOrBrowse(
    kind: string,
    extensions: string[],
    fallback: () => void,
  ): Promise<File | null> {
    if (!cb.pickFile) { fallback(); return null; }
    return cb.pickFile(kind, extensions);
  }

  // --- Image ---
  const drop = $('drop');
  const file = $<HTMLInputElement>('file');
  // With a host this opens its media library — every image imported into any generator,
  // and a way to the file system beyond it. Without one it clicks the hidden input, whose
  // own change handler picks it up from there.
  drop.addEventListener('click', () => {
    void pickOrBrowse('image', ['png', 'jpg', 'jpeg', 'webp'], () => file.click()).then((f) => {
      if (f) cb.onUpload(f);
    });
  });
  file.addEventListener('change', () => {
    if (file.files?.[0]) cb.onUpload(file.files[0]);
  });

  drop.addEventListener('dragenter', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => {
    drop.classList.remove('over');
  });
  drop.addEventListener('drop', () => {
    drop.classList.remove('over');
  });

  // Global drag & drop for the whole window. On `window` rather than the drop zone so a
  // file dropped anywhere else does not navigate the whole page to it — which also means
  // it outlives this UI unless taken off again.
  const onWindowDragover = (e: DragEvent) => e.preventDefault();
  const onWindowDrop = (e: DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    if (f.name.endsWith('.svg')) {
      cb.onSvgUpload(f);
    } else if (f.name.endsWith('.ttf') || f.name.endsWith('.otf') || f.name.endsWith('.json')) {
      cb.onImportFont(f);
    } else if (f.type.startsWith('image/')) {
      cb.onUpload(f);
    } else {
      // A PDF, a HEIC the browser won't decode, a folder — nothing here silently swallowed
      // it before; the app just sat there looking like the drop had not registered (audit #8).
      cb.onStatus("That file type isn't supported. Try an image, SVG or font.");
    }
  };
  window.addEventListener('dragover', onWindowDragover);
  window.addEventListener('drop', onWindowDrop);
  cleanups.push(() => {
    window.removeEventListener('dragover', onWindowDragover);
    window.removeEventListener('drop', onWindowDrop);
  });

  // Choose Sample Picker Modal
  // Inline sample grid: click a thumbnail to load it directly
  /* `role="button"` makes a div ANNOUNCE as a button; it does not make Enter and Space
     activate it. That is the half everyone forgets, and without it the drop zone and the sample
     tiles are focusable and still dead — arguably worse than before, because focus now stops
     somewhere that does nothing. Space is prevented from scrolling the panel, which is what a
     real <button> does too. */
  const activateOnKey = (el: HTMLElement) => {
    el.addEventListener('keydown', (e) => {
      const k = (e as KeyboardEvent).key;
      if (k !== 'Enter' && k !== ' ') return;
      e.preventDefault();
      (e.target as HTMLElement).closest<HTMLElement>('[role="button"]')?.click();
    });
  };
  activateOnKey(drop);

  /* The bundled samples, and then every pack's artwork under its own heading.

     `sampleGrid()` rather than the six `<div role="button" tabindex="0">` tiles that were
     here: `role="button"` announces as a button without being one, which is why the block
     above exists to bolt Enter and Space back on. Fifteen pack tiles in that same shape
     would have made the problem three times the size, and `check:ui` would not have said a
     word — a div is not a control it counts.

     One grid per pack, in `orderedPacks` order, so the pack whose season it is leads. They
     sit in the Image panel and not behind a "Packs" tab because the source row above is
     image / SVG / icon / text / blocks, and those are FORMATS: a Packs tab would have to
     re-implement upload, remove-background and the wizard to arrive at the same call this
     makes in one line — and it would split "where do I find artwork" in two. */
  const sampleMount = $('sampleGridMount');
  // Every sample/pack grid, so the loaded one can be marked regardless of which grid it lives
  // in — `mount.ts` knows only the id (audit #2), not which grid holds it.
  const sampleGrids: SampleGridHandle[] = [];
  /* Packs FIRST, samples after. The packs are the artwork people come for and the bundled
     samples are a demo; with the samples on top, the pack sat below the fold of a 768px
     screen and had to be scrolled to — "I need to scroll to see it". */
  for (const pack of orderedDesignPacks()) {
    const grid = sampleGrid({
      // The chip is ordering made visible, never a gate — `inSeason` never hides a pack, so
      // the heading has to explain why Halloween is at the top in October and lower in June.
      heading: inSeason(pack) ? `${pack.name} · in season` : pack.name,
      // Keyed by NAME rather than a `packId:designId` pair: `onSample`'s only channel back
      // from `mount.ts` is the label it built the status line from (`design.name` /
      // `s.name`, below), not an id, so the name is the one string both sides actually share.
      items: pack.designs.map((d) => ({ id: d.name, src: designUrl(pack, d), label: d.name })),
      onPick: (_item, index) => {
        // By index into the same array `items` was built from, rather than re-finding the
        // design by id — the two are already in lockstep (`items` is a 1:1 map of
        // `pack.designs`).
        const design = pack.designs[index];
        // Straight down the sample path: one decode, the same colour wizard, the same
        // quantiser and the same palette an uploaded PNG gets. A pack that imported its
        // artwork its own way would be a second pipeline to keep in step with the first.
        if (design) cb.onSample(() => loadDesignImage(pack, design), design.name);
      },
    });
    sampleGrids.push(grid);
    sampleMount.append(grid);
  }
  const bundledSampleGrid = sampleGrid({
    heading: 'Choose a sample image',
    items: SAMPLES.map((s) => ({ id: s.name, src: s.src, label: s.name })),
    onPick: (_item, idx) => cb.onSample(SAMPLES[idx].load, SAMPLES[idx].name),
  });
  sampleGrids.push(bundledSampleGrid);
  sampleMount.append(bundledSampleGrid);

  /** Mark the tile for whatever is loaded — id `null` clears every grid, an id with no
   *  matching tile (an uploaded image) leaves all of them unmarked too, since only one grid
   *  can ever hold a match and each still has to be told to drop its own. */
  function markLoadedSample(id: string | null) {
    for (const g of sampleGrids) g.setSelected(id);
  }

  // Two views of one setting: the Image tab and the SVG tab each show it and either can
  // change it, so the sync pass pushes the store value back into both.
  const removeBgToggle = toggleSwitch({
    label: 'Remove background',
    help: 'Automatically removes a solid or near-uniform background from the uploaded image so only the subject is traced.',
    checked: initial.removeBg,
    onChange: (v) => cb.onRemoveBg(v),
  });
  $('removeBgMount').append(removeBgToggle);
  // Back into the wizard on the loaded picture: the Result view there is the only place
  // that shows the traced shapes flat, at full size, before a 3D rebuild.
  $('adjustImageMount').append(button({
    label: 'Adjust image…',
    emphasis: 'secondary',
    block: true,
    title: 'Reopen the image wizard: tone, colors, smoothing, and a preview of the traced result.',
    onClick: () => cb.onAdjustImage(),
  }));

  const removeBgSvgToggle = toggleSwitch({
    label: 'Remove background',
    help: 'Drops a solid rectangle painted behind the artwork so only the logo is kept. Turn off to keep the SVG background.',
    checked: initial.removeBg,
    onChange: (v) => cb.onRemoveBg(v),
  });
  $('removeBgSvgMount').append(removeBgSvgToggle);

  // --- SVG Panel Setup ---
  const svgUpload = $<HTMLInputElement>('svgUpload');
  svgUpload.parentElement?.addEventListener('click', (e) => {
    if (!cb.pickFile) return;
    e.preventDefault();
    void pickOrBrowse('svg', ['svg'], () => {}).then((f) => { if (f) cb.onSvgUpload(f); });
  });
  svgUpload.addEventListener('change', () => {
    const f = svgUpload.files?.[0];
    if (f) cb.onSvgUpload(f);
    svgUpload.value = '';
  });

  const uploadGalleryEl = $('uploadGallery');
  let uploadEmptyEl: HTMLElement | null = null;
  function refreshUploadEmptyState() {
    const empty = uploadGalleryEl.querySelectorAll('.icon').length === 0;
    if (empty && !uploadEmptyEl) {
      uploadEmptyEl = document.createElement('div');
      uploadEmptyEl.id = 'uploadGalleryEmpty';
      uploadEmptyEl.textContent = 'No SVGs yet. Drop files or use the upload button.';
      uploadGalleryEl.appendChild(uploadEmptyEl);
    } else if (!empty && uploadEmptyEl) {
      uploadEmptyEl.remove();
      uploadEmptyEl = null;
    }
  }
  refreshUploadEmptyState();

  function makeIconEl(
    thumbUrl: string,
    name: string,
    onClick: (el: HTMLElement) => void
  ) {
    // The kit's tile, not a hand-built one. Every gallery entry is a control and there are about
    // 1,500 of them — as `<div class="icon">` they were the largest single block of the app a
    // keyboard could not reach, and the drift checker could not see them either, because a div
    // is not a control it counts. `.icon` still carries the app's sizing; `thumbTile` carries
    // the button semantics and the focus ring.
    return thumbTile({ src: thumbUrl, label: name, className: 'icon', onClick });
  }

  function addUploadedSvg(svgText: string, name: string, select = true) {
    const blob = new Blob([svgText], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const el = makeIconEl(url, name, (clickedEl) => {
      uploadGalleryEl.querySelectorAll('.icon').forEach((n) => n.classList.remove('active'));
      clickedEl.classList.add('active');
      cb.onSelectSvg(svgText, name);
    });
    uploadGalleryEl.appendChild(el);
    refreshUploadEmptyState();
    if (select) el.click();
  }

  // --- Lucide Icon Panel Setup ---
  const galleryEl = $('gallery');
  const searchEl = $<HTMLInputElement>('iconSearch');
  const searchClearEl = $<HTMLButtonElement>('iconSearchClear');
  const countEl = $('iconCount');

  const GALLERY_PAGE = 240;
  let lucideShown = 0;
  let lucideMatches: any[] = [];
  let moreBtn: HTMLButtonElement | null = null;

  function rankLucide(query: string) {
    const q = query.trim().toLowerCase();
    if (!q) {
      const popularSet = new Set(POPULAR_LUCIDE);
      const popular = POPULAR_LUCIDE
        .map((name) => LUCIDE_ICONS.find((ic) => ic.name === name))
        .filter(Boolean);
      const rest = LUCIDE_ICONS.filter((ic) => !popularSet.has(ic.name));
      return popular.concat(rest);
    }
    const out: { ic: any; rank: number }[] = [];
    for (const ic of LUCIDE_ICONS) {
      const i = ic.name.indexOf(q);
      if (i === -1) continue;
      const rank = ic.name === q ? 0 : i === 0 ? 1 : 2;
      out.push({ ic, rank });
    }
    out.sort((a, b) => a.rank - b.rank || a.ic.name.localeCompare(b.ic.name));
    return out.map((o) => o.ic);
  }

  function renderLucidePage() {
    if (moreBtn) {
      moreBtn.remove();
      moreBtn = null;
    }
    const end = Math.min(lucideShown + GALLERY_PAGE, lucideMatches.length);
    const frag = document.createDocumentFragment();
    for (let i = lucideShown; i < end; i++) {
      const ic = lucideMatches[i];
      const svgText = buildSvg(ic.node);
      const el = makeIconEl(svgDataUrl(svgText), ic.name, (clickedEl) => {
        galleryEl.querySelectorAll('.icon').forEach((n) => n.classList.remove('active'));
        clickedEl.classList.add('active');
        cb.onSelectIcon(svgText, ic.name);
      });
      frag.appendChild(el);
    }
    galleryEl.appendChild(frag);
    lucideShown = end;

    if (lucideShown < lucideMatches.length) {
      moreBtn = document.createElement('button');
      moreBtn.id = 'galleryMore';
      moreBtn.type = 'button';
      moreBtn.textContent = `Show ${Math.min(GALLERY_PAGE, lucideMatches.length - lucideShown)} more (${lucideMatches.length - lucideShown} hidden)`;
      moreBtn.addEventListener('click', renderLucidePage);
      galleryEl.appendChild(moreBtn);
    }
    updateCount();
  }

  function updateCount() {
    const total = lucideMatches.length;
    if (total === 0) {
      countEl.textContent = 'No icons match.';
    } else {
      const visible = Math.min(lucideShown, total);
      countEl.textContent = searchEl.value.trim()
        ? `${total} match${total === 1 ? '' : 'es'}` + (visible < total ? ` · showing ${visible}` : '')
        : `${total} icons` + (visible < total ? ` · showing ${visible}` : '');
    }
  }

  function rebuildGallery() {
    galleryEl.innerHTML = '';
    lucideShown = 0;
    lucideMatches = rankLucide(searchEl.value);
    searchClearEl.style.display = searchEl.value ? 'block' : 'none';
    renderLucidePage();
  }

  let searchTimer: number | null = null;
  searchEl.addEventListener('input', () => {
    if (searchTimer !== null) clearTimeout(searchTimer);
    searchTimer = window.setTimeout(rebuildGallery, 80);
  });
  searchClearEl.addEventListener('click', () => {
    searchEl.value = '';
    rebuildGallery();
    searchEl.focus();
  });

  // Initialize Lucide Gallery
  rebuildGallery();

  // --- Text Panel Setup ---
  const letterTextRow = textareaField({
    label: 'Custom Text',
    value: 'Custom\nText',
    rows: 2,
    maxLength: 30,
    compact: true,
    onInput: (v) => cb.onTextChange(v),
  });
  $('textOnlyField').append(letterTextRow);

  const textScaleRow = sliderRow({
    label: 'Text size',
    help: 'How big the letters print. Above 100% the clicker grows with them rather than the letters being squeezed in — a bigger part prints more reliably than a smaller one. On a preset base shape, below 100% shrinks the letters inside a base that stays the size you set.',
    min: 50, max: 200, step: 5, value: Math.round(initial.textScale * 100), unit: '%',
    onInput: (v) => cb.onTextScale(v / 100),
  });
  $('textScaleMount').append(textScaleRow);
  const textBoldRow = sliderRow({
    label: 'Boldness', help: 'Fattens (or thins) the letter strokes, in mm.',
    min: -0.3, max: 0.8, step: 0.05, value: initial.textBold,
    format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)} mm`,
    onInput: (v) => cb.onTextBold(v),
  });
  $('textBoldMount').append(textBoldRow);
  const letterSpacingRow = sliderRow({
    label: 'Letter spacing', help: 'Squash letters together or spread them apart.',
    min: -0.08, max: 0.4, step: 0.02, value: initial.letterSpacing,
    format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`,
    onInput: (v) => cb.onLetterSpacing(v),
  });
  $('letterSpacingMount').append(letterSpacingRow);
  const lineSpacingRow = sliderRow({
    label: 'Line spacing', help: 'Gap between lines when the text has more than one.',
    min: 0.5, max: 1.8, step: 0.05, value: initial.lineSpacing,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => cb.onLineSpacing(v),
  });
  $('lineSpacingMount').append(lineSpacingRow);
  const fontGrid = $('fontGrid');
  const fontUpload = $<HTMLInputElement>('fontUpload');
  let selectedFontBtn: HTMLElement | null = null;

  fontUpload.parentElement?.addEventListener('click', (e) => {
    if (!cb.pickFile) return;
    e.preventDefault();
    void pickOrBrowse('font', ['ttf', 'otf', 'json'], () => {}).then((f) => {
      if (f) cb.onImportFont(f);
    });
  });
  fontUpload.addEventListener('change', () => {
    const f = fontUpload.files?.[0];
    if (f) cb.onImportFont(f);
    fontUpload.value = '';
  });

  // --- Letter-block arrangement editor ---------------------------------------------
  // One chip per printed block. In a row or a column the chips sit in a line with a
  // hairline "+" in every gap (that is how "I ♥ U" gets its heart); in grid mode they lay
  // out as the actual grid, so a WASD shape is built by emptying the cells you don't want.
  // Clicking a chip edits that block — type a letter, pick a symbol, empty it, or remove
  // it — which is the only way to author a grid, where a text box no longer maps.
  const blockChipsEl = $('blockChips');
  const blocksTextRow = textareaField({
    label: 'Text',
    value: 'Name',
    rows: 1,
    maxLength: 24,
    compact: true,
    onInput: (v) => cb.onBlockText(v),
  });
  $('blocksTextField').append(blocksTextRow);
  const blocksTextEl = blocksTextRow.field;
  let renderedSlots: BlockSlot[] = [];

  blocksTextEl.addEventListener('input', () => cb.onBlockText(blocksTextEl.value));

  function chipFace(slot: BlockSlot): { el: HTMLElement; title: string } {
    const chip = document.createElement('span');
    chip.className = 'block-chip';
    if (slot.kind === 'icon') {
      chip.classList.add('is-icon');
      const info = LUCIDE_ICONS.find((ic) => ic.name === slot.name);
      if (info) {
        const img = document.createElement('img');
        img.src = svgDataUrl(buildSvg(info.node));
        img.alt = slot.name;
        chip.appendChild(img);
      } else {
        chip.textContent = '?';
      }
      return { el: chip, title: slot.name };
    }
    if (slot.kind === 'empty') {
      chip.classList.add('is-empty');
      return { el: chip, title: 'Empty, no block here' };
    }
    chip.textContent = slot.ch;
    return { el: chip, title: `Letter "${slot.ch}"` };
  }

  function renderBlockChips(slots: BlockSlot[]) {
    renderedSlots = slots;
    blockChipsEl.innerHTML = '';

    const addGap = (index: number) => {
      const gap = document.createElement('button');
      gap.type = 'button';
      gap.className = 'block-gap';
      gap.title = 'Insert a symbol here';
      gap.setAttribute('aria-label', `Insert a symbol at position ${index + 1}`);
      gap.textContent = '+';
      gap.addEventListener('click', () => openSymbolPicker(index));
      blockChipsEl.appendChild(gap);
    };

    addGap(0);
    slots.forEach((slot, i) => {
      const { el: chip, title } = chipFace(slot);
      chip.title = `${title}, click to edit`;
      chip.tabIndex = 0;
      chip.addEventListener('click', () => openSlotEditor(i, chip));
      chip.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openSlotEditor(i, chip);
        }
      });
      blockChipsEl.appendChild(chip);
      addGap(i + 1);
    });
  }

  /** Edit one block: retype its letter, swap in a symbol, blank the cell, or delete it. */
  function openSlotEditor(index: number, anchor: HTMLElement) {
    document.querySelector('.slot-editor')?.remove();
    const slot = renderedSlots[index];
    // Restored on close (Escape, an outside click, or a commit) — a popover that hands focus
    // to `<body>` when it goes away is how a keyboard user loses their place in the chip row.
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const pop = document.createElement('div');
    pop.className = 'color-popover slot-editor';
    pop.innerHTML = `
      <label class="slot-editor-label">Letter</label>
      <input class="slot-editor-input" type="text" maxlength="1" autocomplete="off" spellcheck="false"
             value="${slot.kind === 'char' ? slot.ch.replace(/"/g, '&quot;') : ''}" />
      <button type="button" class="secondary slot-editor-symbol">Pick a symbol…</button>
      <button type="button" class="secondary slot-editor-remove">Remove block</button>`;
    document.body.appendChild(pop);

    const r = anchor.getBoundingClientRect();
    pop.style.left = `${Math.min(window.innerWidth - pop.offsetWidth - 10, r.left)}px`;
    pop.style.top = `${Math.min(window.innerHeight - pop.offsetHeight - 10, r.bottom + 6)}px`;

    const close = () => {
      pop.remove();
      document.removeEventListener('mousedown', onOutside, true);
      document.removeEventListener('keydown', onKey, true);
      previouslyFocused?.focus();
    };
    const onOutside = (e: MouseEvent) => {
      if (!pop.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey, true);
    setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);

    const replace = (next: BlockSlot | null) => {
      const slots = renderedSlots.slice();
      if (next === null) slots.splice(index, 1);
      else slots[index] = next;
      close();
      cb.onBlockSlots(slots);
    };

    const input = pop.querySelector('.slot-editor-input') as HTMLInputElement;
    input.addEventListener('input', () => {
      const ch = input.value.trim();
      if (ch) replace({ kind: 'char', ch });
    });
    (pop.querySelector('.slot-editor-symbol') as HTMLElement).addEventListener('click', () => {
      close();
      openSymbolPicker(index, true);
    });
    (pop.querySelector('.slot-editor-remove') as HTMLElement).addEventListener('click', () =>
      replace(null),
    );
    input.focus();
    input.select();
  }

  /** Compact Lucide picker. Inserts the chosen symbol at `index`, or replaces the slot
   *  already there when `replace` is set (used by the per-block editor).
   *
   *  Was a hand-rolled `.wz-overlay`/`.wz-modal` with its own backdrop-click and Escape
   *  wiring — functional, but a second copy of exactly what the kit's `dialog()` already
   *  does, and the one thing it did not do is restore focus to whatever opened it. Routing
   *  through `dialog()` gets that back for free instead of adding a third `previouslyFocused`
   *  variable to this file. */
  function openSymbolPicker(index: number, replace = false) {
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'symbol-search';
    search.placeholder = 'Search symbols…';
    search.autocomplete = 'off';
    search.spellcheck = false;

    const grid = document.createElement('div');
    grid.className = 'symbol-grid';

    const content = document.createElement('div');
    content.className = 'symbol-picker-body';
    content.append(search, grid);

    const handle = dialog({
      title: 'Add a symbol',
      content,
      wide: true,
      actions: [{ label: 'Cancel' }],
    });

    const paint = () => {
      grid.innerHTML = '';
      const frag = document.createDocumentFragment();
      // No query → the curated keycap set only. Typing searches all of Lucide.
      const q = search.value.trim();
      const list = q
        ? rankLucide(q).slice(0, 180)
        : BLOCK_SYMBOLS.map((n) => LUCIDE_ICONS.find((ic) => ic.name === n)).filter(
            (ic): ic is (typeof LUCIDE_ICONS)[number] => !!ic,
          );
      for (const ic of list) {
        const el = makeIconEl(svgDataUrl(buildSvg(ic.node)), ic.name, () => {
          const next = renderedSlots.slice();
          next.splice(index, replace ? 1 : 0, { kind: 'icon', name: ic.name });
          cb.onBlockSlots(next);
          handle.close();
        });
        frag.appendChild(el);
      }
      grid.appendChild(frag);
    };
    let t: number | null = null;
    search.addEventListener('input', () => {
      if (t !== null) clearTimeout(t);
      t = window.setTimeout(paint, 80);
    });
    paint();
    // `dialog()` moves focus to its first button (Cancel) on open; the search box is the
    // actually useful place to land a keyboard/screen-reader user in a picker this size.
    search.focus();
  }

  /* Three segmented pickers that were hand-built `<button class="tab">` rows with delegated
     `closest('[data-x]')` listeners, plus a matching loop elsewhere that toggled `.active`
     by hand. `segmentedControl()` is both halves: `onChange` replaces the delegation and
     `setValue()` replaces the loop, so the two can no longer disagree — and it brings the
     sliding pill with it. */

  /* The block-chain keyring loop: which side it hangs from, and how far along that side.
   *
   * This used to be a d-pad whose arrows moved the loop in directions that did not match what
   * they pointed at: up/down jumped it to a DIFFERENT face on a left/right-mounted loop rather
   * than moving it up or down, because the mapping was "perpendicular arrow = jump face,
   * parallel arrow = slide" — correct as a rule, unreadable as four arrows with no labels.
   * Direct controls instead: a segmented Side picker (`onKeychainEnd`, unchanged) and a slider
   * for the slide, both showing the actual value rather than a d-pad readout underneath. */
  const blockSideTabs = segmentedControl<KeychainSide>({
    label: 'Side',
    help: 'Which side of the block chain the keyring loop hangs from.',
    options: [
      { value: 'top', label: 'Top' },
      { value: 'right', label: 'Right' },
      { value: 'bottom', label: 'Bottom' },
      { value: 'left', label: 'Left' },
    ],
    value: initial.keychainEnd,
    onChange: (v) => cb.onKeychainEnd(v),
  });
  $('keychainEndMount').append(blockSideTabs);

  // arrows: 'horizontal' — the loop slides left/right along the side, so left/right arrows
  // say what a slider's generic thumb did not (audit: "like arrows, left right").
  const keychainSlideRow = stepperRow({
    label: 'Slide along side',
    help: 'Moves the loop along the side it is on, in millimetres. 0 is the middle of that side.',
    min: -40, max: 40, step: 1, value: initial.keychainSlideMm, unit: 'mm',
    arrows: 'horizontal',
    onInput: (v) => cb.onKeychainSlideSet(v),
  });
  $('keychainSlideMount').append(keychainSlideRow);

  $('keychainBlockResetMount').append(button({
    label: 'Reset',
    emphasis: 'ghost',
    onClick: () => cb.onKeychainSlideReset(),
  }));

  const blockOrientTabs = segmentedControl<BlockOrientation>({
    options: [
      { value: 'horizontal', label: 'Horizontal' },
      { value: 'vertical', label: 'Vertical' },
    ],
    value: initial.blockOrientation,
    onChange: (v) => cb.onBlockOrientation(v),
  });
  $('blockOrientMount').append(blockOrientTabs);
  /* Six sliders that were a hand-built `<div class="prow-stacked">` each: a label with a tip,
     a `<input type="text" class="val">` readout, and a bare `<input type="range">`, wired by a
     local `bindValInput()` that re-derived clamp-on-type, select-on-focus and commit-on-
     Enter/blur. `sliderRow()` is all of it, and `format`/`parse` carry the per-slider units. */
  const legendSizeRow = sliderRow({
    label: 'Letter size', help: 'Scales the letter or symbol on the keycap. 100% fills the flat top of the cap.',
    min: 0.5, max: 1.4, step: 0.05, value: initial.legendScale,
    format: (v) => `${Math.round(v * 100)}%`,
    parse: (typed) => typed / 100,
    onInput: (v) => cb.onLegendScale(v),
  });
  $('legendSizeMount').append(legendSizeRow);

  const legendBoldRow = sliderRow({
    label: 'Boldness', help: 'Thickens (or thins) the legend outline in mm. Symbols are hairline strokes, so a little boldness is what makes them print cleanly.',
    min: -0.3, max: 0.8, step: 0.05, value: initial.legendBold,
    format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)} mm`,
    onInput: (v) => cb.onLegendBold(v),
  });
  $('legendBoldMount').append(legendBoldRow);

  function addFontOption(font: FontOption) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'font-grid-btn';
    btn.textContent = font.name;
    btn.style.fontFamily = `"${font.id.replace('bundled-', '')}", "${font.name}", sans-serif`;
    
    btn.addEventListener('click', () => {
      if (selectedFontBtn) selectedFontBtn.classList.remove('active');
      btn.classList.add('active');
      selectedFontBtn = btn;
      cb.onFontSelect(font.id);
    });
    fontGrid.appendChild(btn);
  }

  FONT_OPTIONS.forEach(addFontOption);
  loadBundledFonts(addFontOption);


  // --- Add loading overlay to viewport dynamically ---
  const viewport = $('viewport');
  if (viewport) {
    let overlay = $('loadingOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'loadingOverlay';
      overlay.className = 'loading-overlay';
      overlay.setAttribute('hidden', '');
      overlay.innerHTML = `
        <div class="loading-spinner"></div>
        <div class="loading-text">Generating 3D model…</div>
      `;
      viewport.appendChild(overlay);
    }

    // --- Edit Mode Bar (Color / Extrude) ---
    //
    // The kit's `modeBar()`, which is where this control came from in the first place. What it
    // buys is the thing the hand-built version could not have: one pill that TRAVELS between the
    // two labels over `--dur-in-md`, instead of one background switching off in the same frame
    // another switches on. Five other tab rows in this app already slide; this was the one that
    // blinked, which is what made it read as unfinished next to them.
    //
    // It also deletes two duplicate sync loops that both toggled `.active` from
    // `[data-editmode]`, and the `is-ready` guard means the selection still paints correctly in
    // a background tab, where the ResizeObserver behind the indicator never fires.
    //
    // 'edges' is deliberately NOT an option here. Its button carried a hardcoded
    // `style="display:none"` and nothing ever removed it, so the mode has shipped unreachable —
    // even though its panel, empty state and rebuild path are all complete. Listing it would be
    // enabling an untested mode as a side effect of a UI migration; that is Ian's call to make
    // deliberately, and `editMode: 'edges'` still works the moment it is added back.
    editModes = modeBar<EditMode>({
      modes: [
        { value: 'color', label: 'Color', icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>' },
        { value: 'extrude', label: 'Raise', icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>' },
      ],
      value: initial.editMode,
      onChange: (m) => cb.onEditMode(m),
    });
    editModes.root.id = 'editModeBar';
    viewport.appendChild(editModes.root);

    // --- Separate-letters toggle (text mode, Color + Extrude) ---
    // Off: the whole word is one element (select/recolor/extrude all letters together).
    // On: each letter is its own part, so you can pick and color letters individually.
    // (Blocks mode always separates, so the toggle stays hidden there.)
    const lettersToggle = document.createElement('div');
    lettersToggle.id = 'lettersToggle';
    lettersToggle.className = 'letters-toggle';
    lettersToggle.setAttribute('hidden', '');
    separateLettersToggle = toggleSwitch({
      label: 'Separate letters',
      checked: initial.separateLetters,
      onChange: (v) => cb.onSeparateLetters(v),
    });
    lettersToggle.append(separateLettersToggle);
    viewport.appendChild(lettersToggle);

    // --- Extrude Panel ---
    // Docked over the right sidebar's scroll area (`rightScrollWrap`, built alongside
    // `rightScroll` above) rather than floating over the 3D view: it used to sit centred over
    // the viewport, covering the design it was supposed to be editing. `.edges-panel-head`
    // holds the title beside a close button that hands editing back to Color mode — the
    // panel has no other way out once it is covering the sidebar.
    const extrudePanel = document.createElement('div');
    extrudePanel.id = 'extrudePanel';
    extrudePanel.className = 'edges-panel';
    extrudePanel.setAttribute('hidden', '');
    extrudePanel.innerHTML = `
      <div class="edges-panel-head"><div class="edges-title">Raise part</div></div>
      <div id="extrudeSelCountHint" class="panel-hint"></div>
      <div id="extrudeLevelMount"></div>
      <div class="extrude-chamfer-row" id="extrudeChamferMount"></div>
      <div class="panel-hint">Click a part on the model. Shift-click to select several.</div>
    `;
    extrudePanel.querySelector('.edges-panel-head')?.append(
      iconButton({
        icon: ICONS.close,
        label: 'Close',
        emphasis: 'ghost',
        className: 'edges-panel-close',
        onClick: () => cb.onEditMode('color'),
      }),
    );
    rightScrollWrap.appendChild(extrudePanel);

    /* Was two `<button class="btn" id="extrudeMinus/Plus">` beside a text-only readout div
       that stated the raw number ("Level: 0") with no unit and no explanation — audit #16.
       `stepperRow()` is `onExtrudeStep`'s natural shape once it has one: the callback takes a
       DELTA (it applies the same nudge to every selected part, which can each start at a
       different height), while the row itself only ever reports an ABSOLUTE value — so
       `extrudeLevelLast` is what turns "the row now reads 3" back into "+1 from what it read
       before", the same trick `keychainSizeRow` below needs for the same reason. The help
       text is what answers "why does this have no mm" (audit #16): a level is a fixed step,
       not a continuous height — see `buildClicker`'s `stepHeight`, which is not part of
       `UiState` and so cannot be named here as an exact millimetre count. */
    extrudeLevelRow = stepperRow({
      label: 'Level',
      help: 'Raises or lowers the selected parts in fixed steps. No AMS? Raise one color and print in a single filament, then swap filament at that layer.',
      min: -5, max: 6, value: 0,
      format: (v) => (v > 0 ? `+${v}` : String(v)),
      onInput: (v) => {
        const delta = v - extrudeLevelLast;
        extrudeLevelLast = v;
        cb.onExtrudeStep(delta);
      },
    });
    extrudePanel.querySelector('#extrudeLevelMount')?.append(extrudeLevelRow);
    // The kit toggle stays uncontrolled the way the raw checkbox was: the browser flips it on
    // click and we push the value out. update() only calls setValue() for programmatic changes
    // (undo/redo, project load), so it never fights the user's click.
    extrudeChamferToggle = toggleSwitch({
      label: 'Chamfer edges',
      help: 'Bevels the top edge of every raised color part, so a stepped color reads as a deliberate facet rather than a sharp ledge.',
      checked: initial.extrudeChamfer,
      onChange: (v) => cb.onExtrudeChamfer(v),
    });
    extrudePanel.querySelector('#extrudeChamferMount')?.append(extrudeChamferToggle);

    // --- Edges Panel ---
    // Docked the same way as the Raise panel above (see that comment).
    const edgesPanel = document.createElement('div');
    edgesPanel.id = 'edgesPanel';
    edgesPanel.className = 'edges-panel';
    edgesPanel.setAttribute('hidden', '');
    edgesPanel.innerHTML = `
      <div class="edges-panel-head"><div class="edges-title" id="edgesTitle"><span id="edgesTitleText">Edge Modifications</span></div></div>
      <div id="edgesContent"></div>
      <div class="panel-hint">Select a part to round (fillet) or bevel (chamfer) its top edge. Shift-click for several.</div>
    `;
    rightScrollWrap.appendChild(edgesPanel);
    // The title text is rewritten on every sync (`edgesTitleText`, below) — audit #16 flagged
    // this floating panel as having no help anywhere, so the tip lives beside the title
    // instead, where it survives that rewrite.
    edgesPanel.querySelector('#edgesTitle')?.append(
      helpTip('None leaves the edge sharp. Fillet rounds it; Chamfer bevels it at an angle.'),
    );
    edgesPanel.querySelector('.edges-panel-head')?.append(
      iconButton({
        icon: ICONS.close,
        label: 'Close',
        emphasis: 'ghost',
        className: 'edges-panel-close',
        onClick: () => cb.onEditMode('color'),
      }),
    );

    // The style row (None/Fillet/Chamfer) is a segmentedControl() built per target in
    // `update()` now and fires through its own `onChange` — only the size +/- stepper is
    // still a hand-built pair delegated from here.
    edgesPanel.addEventListener('click', (e) => {
      const targetEl = e.target as HTMLElement;
      if (targetEl.classList.contains('edge-size-minus') || targetEl.classList.contains('edge-size-plus')) {
        const sizeRow = targetEl.closest('.edge-size-btns') as HTMLElement;
        const target = sizeRow.dataset.edge;
        const delta = targetEl.classList.contains('edge-size-minus') ? -0.2 : 0.2;
        if (target) cb.onEdgeStep(target, delta);
      }
    });
  }

  // --- Import mode tabs ---
  // Was five hand-built `<button class="import-card" data-mode="…">` cards with a delegated
  // `[data-mode]` click listener, plus a matching sync loop below that toggled `.active` by
  // hand — the exact shape CLAUDE.md records as a shipped invisible bug (the view tabs went
  // that way once the row stopped carrying the attribute the loop was still reading).
  // `variant: 'cards'` is what the kit needed to widen: `segmentedControl()` on its own is a
  // pill of centred text, and five source names plus icons do not fit that — Blocks alone is
  // wider than "SVG", so a plain tab either truncates or drops the icon. The odd fifth option
  // (Blocks) spans the row on its own; see `.vl-tabs--cards` in the kit for why that is a CSS
  // rule and not a per-card class here.
  const importTabsCtl = segmentedControl<UiState['importMode']>({
    variant: 'cards',
    columns: 2,
    options: [
      { value: 'image', label: 'Image', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>' },
      { value: 'svg', label: 'SVG', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>' },
      { value: 'icon', label: 'Icon', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>' },
      { value: 'text', label: 'Text', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>' },
      { value: 'blocks', label: 'Blocks', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="6.5" height="10" rx="1.4"/><rect x="8.75" y="7" width="6.5" height="10" rx="1.4"/><rect x="15.5" y="7" width="6.5" height="10" rx="1.4"/></svg>' },
    ],
    value: initial.importMode,
    onChange: (v) => cb.onImportMode(v),
  });
  $('importTabsMount').append(importTabsCtl);

  // --- Colors ---
  // Was a raw `<select id="ccount">` with 11 hardcoded options. `selectField()` is the row;
  // the one thing it does not do on its own is show a value outside those options, which
  // limited-mode colour counts need — `setFieldOptions()` (also from the kit, built for a
  // generator whose option list itself changes) is what `update()` reaches for below to inject
  // and remove the synthetic "N Colors (Limited)" entry.
  const ccountField = selectField({
    label: 'Colors',
    help: 'How many distinct filament colors the image is split into. Each color becomes a separate part in the export.',
    options: COLOR_COUNT_OPTIONS,
    value: String(initial.colorCount),
    onChange: (v) => cb.onColorCount(+v),
  });
  $('ccountMount').append(ccountField);
  const smoothRow = sliderRow({
    label: 'Smoothing', help: 'Simplifies and smooths the traced outlines. Higher values give fewer, cleaner edges; lower keeps more fine detail.',
    min: 0, max: 1, step: 0.05, value: initial.smoothing,
    // Stored 0-1, shown as a percentage: `parse` is what makes typing "50%" mean 0.5
    // rather than 50 clamped to the top of the range.
    format: (v) => `${Math.round(v * 100)}%`,
    parse: (typed) => typed / 100,
    onInput: (v) => cb.onSmoothing(v),
  });
  $('smoothMount').append(smoothRow);

  // --- Shape ---

  /* The last of the five tab rows. This one needed `setOptionVisible`, which the kit did not
     have: icon line-art makes a broken outline body, so in icon mode the Outline option is
     hidden rather than merely disabled. Hiding it from app CSS would not have worked — the
     grid's column count comes from the option count, so a `display: none` child leaves a dead
     column and the sliding indicator travels into the gap. */
  const shapeTypeTabs = segmentedControl<'outline' | 'shape'>({
    options: [
      { value: 'outline', label: 'Outline' },
      { value: 'shape', label: 'Shape' },
    ],
    value: isOutlineBase(initial) ? 'outline' : 'shape',
    onChange: (v) => {
      // Switching back to Shape re-applies whatever shape is already selected, so the tabs
      // never silently change WHICH shape you have — only whether it is used.
      if (v === 'outline') cb.onShape('outline');
      else cb.onShapePick(lastShapeId);
    },
  });
  $('shapeTypeTabsMount').append(shapeTypeTabs);

  /* The base-shape directory.

     A `<select>` held seven options and there are now several hundred, which is the whole
     reason this is a picker and not a longer dropdown: a dropdown cannot show you what a
     shape LOOKS like, and a shape is a picture. The kit's symbol picker already does the hard
     parts — search, category chips, paging, a drawer that leaves the model visible while you
     click through — so this widens that with an SVG preview rather than growing a second one.

     Thumbnails come from the same ring functions the geometry does (`shapePaths.ts`), so a
     tile cannot show something the build would not produce. */
  /** The last non-outline shape chosen, so switching Outline → Shape restores it. */
  let lastShapeId = 'circle';

  const shapeBtn = button({
    label: 'Choose a shape',
    emphasis: 'secondary',
    block: true,
    onClick: () => {
      // Pack silhouettes are files that have to be fetched and traced. Doing it here rather
      // than at startup keeps them off the boot path for a control most sessions never open;
      // it is idempotent, so only the first open pays.
      void loadPackShapes().then(() => {
        const st = latestState;
        openShapePicker({
          selectedId: st ? (entryForState(st.baseShape, st.packShapeToken)?.id ?? null) : null,
          params: {
            shapeSides: st?.shapeSides ?? 5,
            shapeCornerPct: st?.shapeCornerPct ?? 0.22,
            shapeArmPct: st?.shapeArmPct ?? 0.56,
          },
          onPick: (entry) => cb.onShapePick(entry.id),
          onSides: (n) => cb.onShapeSides(n),
          onCornerPct: (v) => cb.onShapeCorner(v),
          onArmPct: (v) => cb.onShapeArm(v),
          onDrawYourOwn: () => cb.onEditShape(),
        });
      });
    },
  });
  $('shapePickMount').append(shapeBtn);

  // --- Size sliders ---
  const widthRow = sliderRow({
    label: 'Size', help: 'Overall size of the clicker (its longest side, in mm). This scales the whole model proportionally, not just the width.',
    min: 20, max: 70, step: 1, value: initial.capWidthMm, unit: 'mm',
    onInput: (v) => cb.onWidth(v),
  });
  $('widthMount').append(widthRow);

  /* Size scales the base and the design together, and always did — their ratio was welded shut
     by `imageMargin`, a hardcoded literal in mount.ts that no control ever reached. So there was
     no way to put a small logo on a big badge. This is the other half of the listing complaints
     the outline size clamp already quotes; the clamp fixed the "slider does nothing" half. */
  const designScaleRow = sliderRow({
    label: 'Design size',
    help: 'How much of the base your design fills. The base stays exactly the size you set: lower leaves a wider plain frame around the artwork, and above 100% the artwork is cropped by the frame. Does nothing when the base follows your design’s outline, because there the shape and the artwork are the same thing.',
    min: 30, max: 200, step: 5, value: Math.round((initial.designScale ?? 1) * 100), unit: '%',
    onInput: (v) => cb.onDesignScale(v / 100),
  });
  $('designScaleMount').append(designScaleRow);

  /* --- Lock the base size -------------------------------------------------------------
     Free, and the fix for a control that reads as broken. On an outline base the build has
     to scale a design up until it clears the switch, so for anything narrower than ~18 mm
     the Size slider produces byte-identical geometry at 20, 30, 40, 50 and 60 — five
     positions, one part, and until the fit pass added a warning, nothing said so. It is
     behind "it makes the clicker quite large compared to the single switch", "is there a way
     to scale the picture bigger when using the Base Style" and "even when I size it up".

     Locking the size inverts the sizing: the base is what you asked for and the design is
     fitted into it. Which is also, not by coincidence, the thing that makes forty different
     names print as one product — see src/pro/ for what a seller does with it. */
  let latestState: UiState | null = null;
  let lastBuiltBody: { w: number; h: number } | null = null;

  const fixedSizeToggle = toggleSwitch({
    label: 'Lock the base size',
    help: 'Pins the finished base to an exact width and height and fits your design inside it, instead of sizing the base from the design. Turn it on to get the same part every time — and to get out of the case where Size appears to do nothing because the design is narrower than the switch.',
    checked: !!initial.fixedSize,
    onChange: (on) => {
      if (!on) { cb.onFixedSize(null); return; }
      // Seed from what is on screen, so switching the lock ON never resizes the model. A
      // lock that moved the thing it locked would be read as a bug, and rightly.
      const seed = lastBuiltBody ?? { w: 40, h: 40 };
      cb.onFixedSize({ w: Math.round(seed.w), h: Math.round(seed.h) });
    },
  });
  $('fixedSizeMount').append(fixedSizeToggle);

  /** Read the pair off the two sliders, so either one edits without clobbering the other. */
  const emitFixed = (w: number, h: number) => cb.onFixedSize({ w, h });
  const fixedWRow = sliderRow({
    label: 'Base width',
    help: 'Outer width of the finished base, in mm — the number you would measure with calipers.',
    min: 24, max: 120, step: 1, value: initial.fixedSize?.w ?? 40, unit: 'mm',
    onInput: (v) => emitFixed(v, fixedHRow.getValue()),
  });
  const fixedHRow = sliderRow({
    label: 'Base height',
    help: 'Outer height of the finished base, in mm.',
    min: 24, max: 120, step: 1, value: initial.fixedSize?.h ?? 40, unit: 'mm',
    onInput: (v) => emitFixed(fixedWRow.getValue(), v),
  });
  $('fixedWMount').append(fixedWRow);
  $('fixedHMount').append(fixedHRow);

  const topthickRow = sliderRow({
    label: 'Top thickness', help: 'Thickness of the solid top layer beneath the colored image, in mm.',
    min: 1, max: 4, step: 0.1, value: initial.topThickness,
    format: (v) => `${v.toFixed(1)} mm`,
    onInput: (v) => cb.onTopThickness(v),
  });
  $('topthickMount').append(topthickRow);

  const imgdepthRow = sliderRow({
    label: 'Image depth', help: 'How far the colored image is raised into the top surface, in mm.',
    min: 0.2, max: 3, step: 0.1, value: initial.imageDepth,
    format: (v) => `${v.toFixed(1)} mm`,
    onInput: (v) => cb.onImageDepth(v),
  });
  $('imgdepthMount').append(imgdepthRow);

  // The geometry for this shipped long ago — `capProud` sets where the body border sits
  // relative to the cap top, so pressing the cap by one travel brings the two flush. There
  // was just never a control, and a user was told the option did not exist.
  /* Shown INVERTED. The store keeps `capProud` (how far the button stands above the body rim),
     but the slider reads as the rim: "if I slide the slider to the max I expect it to make
     the body bigger, not vice versa". So the value on screen is how much the rim rises around
     the button, and the two always add up to the same total. */
  const RIM_SPAN = 6.4; // = min + max of the underlying capProud range
  const capProudRow = sliderRow({
    label: 'Body rim height',
    help: 'How far the body wall rises around the button. Higher hides more of the button; the button always stands at least a little proud so it can still be pressed. The build lowers the rim on its own if the border is too short for it.',
    min: 0.4, max: 6, step: 0.2, value: RIM_SPAN - initial.capProud, unit: 'mm',
    onInput: (v) => cb.onCapProud(RIM_SPAN - v),
  });
  $('capProudMount').append(capProudRow);

  // Free, and off by default. Off because it changes what an existing saved design renders
  // as, and because the wall thickness wants a real print before anyone's default moves.
  const hollowToggle = toggleSwitch({
    label: 'Hollow the base',
    help: 'Prints the base as a shell instead of a solid block, which saves a lot of filament on bigger clickers. The switch column and its surround stay solid. Off by default.',
    checked: initial.hollowBase,
    onChange: (v) => cb.onHollowBase(v),
  });
  $('hollowMount').append(hollowToggle);

  // The answer to "what number do I type". Ghost, and under the fit controls rather than
  // beside Export, because it is a diagnostic you reach for once and then never again.
  $('fitTestMount').append(button({
    label: 'Print a fit test',
    emphasis: 'secondary',
    icon: ICONS.target,
    block: true,
    onClick: () => cb.onFitTest(),
  }));

  /* --- The three fit controls ---------------------------------------------------------
     Every one of them reads 0 on a fresh design and 0 means the geometry that ships today,
     so nobody's working settings move. What changed is that each is now named after the pair
     of surfaces it actually moves. The old pair had one control labelled "Switch socket
     tolerance" that only ever set the cap-to-body gap, and one labelled in millimetres that
     moved the gripping slot by about a seventh of them — between them they produced both
     open fit complaints on the listing, from opposite directions.

     The two stem/pocket controls are percentages because what they scale is a hole, and a
     percentage of a hole is a number that stays true. See `stemFitPct` in types.ts. */
  const pct = (v: number) => (v > 0.001 ? '+' : v < -0.001 ? '−' : '') + Math.abs(v).toFixed(1) + '%';

  const gapTolRow = stepperRow({
    label: 'Top / base gap',
    help: 'Clearance between the top part and the base it presses into. Press + if the two halves are hard to fit together or the top scrapes, − if they feel loose. 0 = the default fit.',
    min: 0.1, max: 1.0, step: 0.05, value: initial.tolerance,
    format: (v) => fmtSignedMm(v - BASE_SOCKET_TOL, 2),
    parse: (typed) => typed + BASE_SOCKET_TOL,
    onInput: (v) => cb.onGapTolerance(v),
  });
  $('gapTolMount').append(gapTolRow);

  const stemFitRow = stepperRow({
    label: 'Switch stem fit (top part)',
    help: 'How tightly the top part grips the stem of your MX switch. Press + if the top is hard to push on or the post splits, − for a firmer grip. 0 = as designed.',
    min: -5, max: 5, step: 0.5, value: initial.stemFitPct,
    format: pct,
    onInput: (v) => cb.onStemFit(v),
  });
  $('stemFitMount').append(stemFitRow);

  const socketFitRow = stepperRow({
    label: 'Switch pocket fit (base)',
    help: 'How tightly the switch itself sits in the base. Press + if the switch is hard to push in, − if it rattles or falls out. 0 = as designed.',
    min: -5, max: 5, step: 0.5, value: initial.socketFitPct,
    format: pct,
    onInput: (v) => cb.onSocketFit(v),
  });
  $('socketFitMount').append(socketFitRow);

  // What used to open itself on load, telling first-time visitors what had changed "since your
  // last visit". It is the answer to "has my bug been fixed", so it is worth keeping — but it is
  // a question people ask, not one to interrupt them with.
  $('updatesMount').append(changelogButton({ entries: CHANGELOG, title: 'Clicker updates' }));

  /* --- The two directional pads ---

     These were 12 hand-built `<button class="switch-pad-btn">` elements written into the
     sidebar's innerHTML, with delegated `[data-dir]` / `[data-rot]` / `[data-nudge]`
     listeners on top. The kit's `dpad()` is a straight port of this very control — the
     clicker is where it came from — so the markup and the delegation both go, and the
     component supplies the readout too.

     One deliberate behaviour gain: `dpad()` holds-to-repeat (fires on pointerdown, then
     repeats after 300ms). Nudging a switch a millimetre at a time used to need one click
     per millimetre. */
  const SWITCH_STEP = 1; // mm per press
  const switchDpad = dpad({
    readout: 'Centered',
    onMove: (dir) => {
      if (dir === 'up') cb.onSwitchNudge(0, SWITCH_STEP);
      else if (dir === 'down') cb.onSwitchNudge(0, -SWITCH_STEP);
      else if (dir === 'left') cb.onSwitchNudge(-SWITCH_STEP, 0);
      else cb.onSwitchNudge(SWITCH_STEP, 0);
    },
    // Signed like the old `data-rot`: left was +3, right -3, and the kit uses the same sign.
    onRotate: (deltaDeg) => cb.onSwitchRotate(deltaDeg),
    onReset: () => cb.onSwitchReset(),
  });
  $('switchPadMount').replaceWith(switchDpad.root);

  const NUDGE_STEP = 0.5; // mm per press
  const imageDpad = dpad({
    readout: 'Centered',
    rotate: false,
    onMove: (dir) => {
      if (dir === 'up') cb.onImageNudge(0, NUDGE_STEP);
      else if (dir === 'down') cb.onImageNudge(0, -NUDGE_STEP);
      else if (dir === 'left') cb.onImageNudge(-NUDGE_STEP, 0);
      else cb.onImageNudge(NUDGE_STEP, 0);
    },
    onReset: () => cb.onImageNudgeReset(),
  });
  $('imageNudgePadMount').replaceWith(imageDpad.root);

  // --- Switch count + active-switch chips + reset-all ---
  const switchCountTabs = segmentedControl<'1' | '2' | '3'>({
    options: [
      { value: '1', label: '1' },
      { value: '2', label: '2' },
      { value: '3', label: '3' },
    ],
    value: String(initial.switches.length) as '1' | '2' | '3',
    onChange: (v) => cb.onSwitchCount(+v),
  });
  $('switchCountMount').append(switchCountTabs);
  /* The active-switch chips (S1/S2/S3), shown only for 2-3 switches. Was a `<button
     class="tab" data-sw="…">` string rebuilt by `.innerHTML` whenever the count changed, with
     a delegated `[data-sw]` click listener and a matching sync loop that toggled `.active` by
     hand below — the S2/S3 case of this very migration's item #7. `setOptionVisible` is what
     the rebuild-on-count-change existed for: the three options are built once and S2/S3 are
     hidden rather than never created, so there is no "does the chip for this index exist yet"
     bookkeeping left to get wrong. */
  const activeSwitchTabs = segmentedControl<'0' | '1' | '2'>({
    options: [
      { value: '0', label: 'S1' },
      { value: '1', label: 'S2' },
      { value: '2', label: 'S3' },
    ],
    value: String(initial.activeSwitchIndex) as '0' | '1' | '2',
    onChange: (v) => cb.onActiveSwitch(+v),
  });
  $('switchChipsMount').append(activeSwitchTabs);
  $('switchResetAll').addEventListener('click', () => cb.onSwitchResetAll());

  const keychainToggle = toggleSwitch({
    label: 'Keychain',
    help: 'Adds a keyring attachment to the body so you can clip the clicker to a keychain.',
    checked: initial.keychain.enabled,
    onChange: (v) => cb.onKeychainToggle(v),
  });
  $('keychainMount').append(keychainToggle);

  /* Two sliders instead of a d-pad.
   *
   * `angleDeg` picks the bearing round the body edge (90° = top) and `offsetMm` is a small
   * shift along the tangent from there, for a shape where the ray from the centre lands
   * awkwardly (a heart, a star). The d-pad this replaces mapped them to left/right (coarse)
   * and up/down (fine) — arrows that moved the loop by an amount and a direction neither
   * pointed at, which is the "arrows that do not move the loop the way they point" complaint.
   * Both callbacks are absolute (`onKeychainAngle`, `onKeychainOffsetSet`): the slider always
   * reports the value it shows, so there is no delta bookkeeping to keep pinned across
   * renders the way the hole-size stepper below still needs. */
  const keychainAngleRow = sliderRow({
    label: 'Loop position',
    help: 'Where the keyring loop sits around the edge. 90° is the top.',
    min: 0, max: 360, step: 5, value: initial.keychain.angleDeg, unit: '°',
    onInput: (v) => cb.onKeychainAngle(v),
  });
  $('keychainAngleMount').append(keychainAngleRow);

  // arrows: 'horizontal' — same reasoning as the block-chain slide below: the offset is a
  // left/right nudge along the edge, not a swept quantity, so left/right arrows read the way
  // the motion happens rather than asking "which way is minus".
  const keychainOffsetRowCtl = stepperRow({
    label: 'Fine offset',
    help: 'Nudges the loop along the edge by a small amount, without changing the angle above. Useful on a shape where the edge does not sit exactly where the angle points.',
    min: -15, max: 15, step: 0.5, value: initial.keychain.offsetMm, unit: 'mm',
    arrows: 'horizontal',
    onInput: (v) => cb.onKeychainOffsetSet(v),
  });
  $('keychainOffsetMount').append(keychainOffsetRowCtl);

  $('keychainFreeResetMount').append(button({
    label: 'Reset',
    emphasis: 'ghost',
    onClick: () => cb.onKeychainReset(),
  }));

  /* Was a `<button class="btn" id="keychainSizeMinus/Plus">` pair around a plain `<span>`
     readout. `onKeychainSize` takes a DELTA (mount.ts clamps the result to 3.0-8.0mm), while
     `stepperRow()` only ever reports an ABSOLUTE value, so `keychainHoleLast` is what turns
     "the row now reads 5.6" back into "+0.4 from what it read before" — `update()` keeps it
     pinned to the real state on every render, so a click can never drift from it.
     `min: 3.2` rather than the true 3.0 floor: the row snaps whatever it shows to a
     `min + n*step` grid, and 3.0 is not on the same 0.4mm grid as the 5.2mm default — 3.2 is,
     so the default (and every value a click can reach) round-trips exactly instead of
     display-snapping to the nearest 0.4 away from what is actually stored. */
  let keychainHoleLast = initial.keychain.holeDiameterMm;
  const keychainSizeRow = stepperRow({
    label: 'Hole size',
    help: 'Diameter of the ring hole. Size it for a keyring, cord, or carabiner.',
    min: 3.2, max: 8, step: 0.4, value: keychainHoleLast,
    format: (v) => `${v.toFixed(1)} mm`,
    onInput: (v) => {
      const delta = v - keychainHoleLast;
      keychainHoleLast = v;
      cb.onKeychainSize(delta);
    },
  });
  $('keychainSizeMount').append(keychainSizeRow);

  /** None / Fillet / Chamfer, shared by the two global edge rows (Shape & Size) and every
   *  per-part row in the floating Edges panel. Was a `<button class="edge-style-btn">` triple
   *  in each spot with its own delegated `[data-style]` listener and a matching `.active`
   *  toggle loop in `update()` — the same shape as the import cards and the switch chips,
   *  duplicated once per edge target instead of fixed once here. */
  function edgeStyleTabs(target: string, value: EdgeStyle) {
    return segmentedControl<EdgeStyle>({
      options: [
        { value: 'none', label: 'None' },
        { value: 'fillet', label: 'Fillet' },
        { value: 'chamfer', label: 'Chamfer' },
      ],
      value,
      onChange: (v) => cb.onEdgeStyle(target, v),
    });
  }

  /** One row per selected part in the floating Edges panel: the segmented style control plus
   *  the size stepper it shows once a style is picked. Rebuilt only when the selection
   *  changes (see `update()`), so this is what survives that rebuild to be read back from. */
  const partEdgeRows = new Map<
    string,
    { tabs: SegmentedRow<EdgeStyle>; sizeRow: HTMLElement; radiusLabelEl: HTMLElement }
  >();

  // --- Typeable value inputs: parse typed number, commit on Enter / blur ---

  /* The three sidebar sections are written into the innerHTML above, so
     `collapsibleSection()` never built them and they were the one part of the panel that
     snapped open in a single frame while the chevron beside them eased. `makeCollapsible`
     hands them the kit's animation without restructuring the template. */
  for (const d of document.querySelectorAll<HTMLDetailsElement>('details.vl-section--collapsible')) {
    makeCollapsible(d);
  }

  // --- View tabs ---
  const viewTabs = segmentedControl<ViewMode>({
    options: [
      { value: 'assembled', label: 'Assembled' },
      { value: 'exploded', label: 'Exploded' },
    ],
    value: initial.view,
    onChange: (v) => cb.onView(v),
  });
  $('viewTabsMount').append(viewTabs);

  const showSwitchToggle = toggleSwitch({
    label: 'Show MX switch',
    help: 'Shows a reference MX switch in the preview so you can check the fit. It is not part of the exported model.',
    checked: initial.showSwitch,
    onChange: (v) => cb.onShowSwitch(v),
  });
  $('showSwitchMount').append(showSwitchToggle);

  // --- Export and Utility actions ---
  // Export / Save / Load / Help / theme now live in the shared ui-kit sidebar
  // footer (created above); its callbacks call cb.onExport / cb.onSaveProject /
  // showTutorialPrompt directly. The only piece still wired here is the hidden
  // project-file input the footer's onLoad forwards a file to.
  const projFile = $<HTMLInputElement>('projFile');
  projFile.addEventListener('change', () => {
    if (projFile.files?.[0]) cb.onLoadProject(projFile.files[0]);
    projFile.value = '';
  });

  // Help tooltips are the kit's `helpTip()` now (see `tip()` / `resolveHelpTips()` above) —
  // each marker owns its own bubble and positioning, so there is nothing left to wire here.

  function getFilamentNameAndHex(rgb: RGB): [string, string] {
    let bestHex = rgbHex(rgb);
    let bestName = 'Custom Color';
    let bestD = Infinity;
    for (const [name, hex] of FILAMENTS) {
      const [fr, fg, fb] = hexRgb(hex);
      const dr = rgb[0] - fr;
      const dg = rgb[1] - fg;
      const db = rgb[2] - fb;
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) {
        bestD = d;
        bestHex = hex;
        bestName = name;
      }
    }
    return [bestName, bestHex];
  }

  // Robust floating swatch picker. Anchored at (clientX, clientY) — typically the
  // cursor or a trigger element's corner — then measured and clamped so it always
  // stays fully on-screen (the old version could land in the top-left corner).
  function showColorPopoverAt(
    clientX: number,
    clientY: number,
    currentHex: string,
    options: RGB[],
    handlers: { onSelect: (hex: string) => void; onClose?: () => void }
  ) {
    document.getElementById('sbColorPopover')?.remove();

    // Restored on close. The trigger for this popover is often a click on the 3D canvas
    // (mount.ts) rather than a focusable control, so this can legitimately be null — in
    // which case there is simply nothing to give focus back to.
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const popover = document.createElement('div');
    popover.id = 'sbColorPopover';
    popover.className = 'color-popover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', 'Choose a color');
    document.body.appendChild(popover);

    let done = false;
    const close = () => {
      if (done) return;
      done = true;
      popover.remove();
      document.removeEventListener('mousedown', dismiss);
      document.removeEventListener('keydown', onKey, true);
      handlers.onClose?.();
      previouslyFocused?.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey, true);

    options.forEach((rgb) => {
      const hex = rgbHex(rgb);
      const [name] = getFilamentNameAndHex(rgb);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.style.background = hex;
      btn.title = name;
      if (hex.toLowerCase() === currentHex.toLowerCase()) btn.classList.add('active');
      btn.addEventListener('click', () => {
        handlers.onSelect(hex);
        close();
      });
      popover.appendChild(btn);
    });

    // Custom color: live-updates while dragging, stays open until dismissed.
    const custom = document.createElement('label');
    custom.className = 'cp-custom';
    custom.title = 'Custom color';
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.value = /^#[0-9a-f]{6}$/i.test(currentHex) ? currentHex : '#888888';
    /* The wheel fires `input` on every step of a drag, so remembering the colour there filled
       the design's palette with a dozen near-identical oranges. The colour joins the palette
       once, when the popover closes, and only if the wheel was touched at all — clicking an
       existing swatch is not a new colour. */
    let wheelUsed = false;
    inp.addEventListener('input', () => { wheelUsed = true; handlers.onSelect(inp.value); });
    const closeHandlers = handlers.onClose;
    handlers.onClose = () => {
      if (wheelUsed) cb.onCustomColor(inp.value);
      closeHandlers?.();
    };
    custom.appendChild(inp);
    popover.appendChild(custom);

    // Measure now that it's populated, then clamp into the viewport.
    const w = popover.offsetWidth || 170;
    const h = popover.offsetHeight || 180;
    popover.style.left = `${Math.max(8, Math.min(clientX, window.innerWidth - w - 8))}px`;
    popover.style.top = `${Math.max(8, Math.min(clientY, window.innerHeight - h - 8))}px`;

    const dismiss = (e: MouseEvent) => {
      if (!popover.contains(e.target as Node)) close();
    };
    setTimeout(() => document.addEventListener('mousedown', dismiss), 50);

    // Move focus in, so Tab and Escape work immediately rather than leaving focus wherever
    // the triggering click left it — often nowhere focusable at all, when the trigger was a
    // click on the 3D canvas.
    (popover.querySelector<HTMLElement>('button, input') ?? popover).focus();
  }

  /** The colours the shared popover offers for EVERY row on this palette, built once per
   *  render rather than per row: any custom colour not already covered by the current shelf
   *  (a saved project or a shared link can carry a colour that needs its own entry to show
   *  as selected), then the shelf itself — the picture's own limited-mode set when this
   *  model's colour count is capped to one, otherwise the full filament list. This is the
   *  same de-dupe `mount.ts`'s 3D-click handler runs before calling `showColorPopoverAt` for
   *  a clicked part; computing it the same way here is what keeps the two entry points
   *  offering one identical list instead of two that can quietly drift apart. */
  function colorOptionsFor(
    colorMode: 'normal' | 'limited' | undefined,
    limitedColors: RGB[] | undefined,
    customColors: RGB[],
  ): RGB[] {
    const shelf: RGB[] =
      colorMode === 'limited' && limitedColors && limitedColors.length > 0
        ? limitedColors
        : FILAMENTS.map(([, hex]) => hexRgb(hex));
    const sameRgb = (a: RGB, b: RGB) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
    return [...customColors.filter((c) => !shelf.some((o) => sameRgb(o, c))), ...shelf];
  }

  /** One compact colour row: a dot for the colour the image actually traced to (not
   *  necessarily the filament chosen to print it), the row's label, and a `colorChip()`
   *  holding the filament currently assigned.
   *
   *  This replaces a full `filamentRow()` — all fourteen shelf swatches, repeated on every
   *  row — which is what Ian meant by "the left side of the palette feels cut off" and "this
   *  big palette item that sometimes just disappears": the custom-colour chip that appears
   *  only for an off-palette value could land alone on a wrapped second row, or overflow the
   *  333px sidebar outright, depending on how many swatches came before it. The chip opens
   *  the SAME `showColorPopoverAt` popover a click on the 3D model opens, given the SAME
   *  options list (`colorOptionsFor`, above) — one picker, one offered list, instead of a
   *  shelf here and a different popover there that could show different colours for the
   *  same part. */
  function paletteRow(
    label: string,
    valueHex: string,
    options: RGB[],
    onChange: (hex: string) => void,
    quantHex?: string,
  ): HTMLElement {
    const labelEl = document.createElement('span');
    labelEl.className = 'palette-row__label';
    if (quantHex) {
      const dot = document.createElement('span');
      dot.className = 'fil-quant-dot';
      dot.style.background = quantHex;
      dot.title = 'Detected color';
      labelEl.append(dot);
    }
    labelEl.append(document.createTextNode(label));

    const chip = colorChip({
      hex: valueHex,
      label: `${label} colour`,
      onClick: (e) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        showColorPopoverAt(rect.left, rect.bottom + 6, valueHex, options, {
          onSelect: (hex) => {
            chip.setValue(hex);
            onChange(hex);
          },
        });
      },
    });

    const row = document.createElement('div');
    row.className = 'palette-row';
    row.append(labelEl, chip);
    return row;
  }

  function renderPalette(
    palette: PaletteEntry[],
    bodyColorRgb: RGB,
    colorMode?: 'normal' | 'limited',
    limitedColors?: RGB[],
    blocks?: { capRgb: RGB },
    recolored = 0,
    customColors: RGB[] = [],
  ) {
    const pal = $('palette');
    pal.innerHTML = '';

    // The tip, plus — once shapes have been recolored one by one — the way back. A
    // palette row only resets its own bucket, so without this a scattered set of
    // per-shape colors has no single undo.
    const appendTip = (text: string) => {
      const tip = document.createElement('div');
      tip.className = 'hint model-recolor-tip';
      tip.textContent = text;
      pal.appendChild(tip);
      if (recolored <= 0) return;
      const reset = button({
        label: `Reset ${recolored} recolored shape${recolored === 1 ? '' : 's'}`,
        emphasis: 'ghost',
        block: true,
        className: 'reset-part-colors',
        title: 'Put every individually recolored shape back on its palette row',
        onClick: (e) => {
          e.stopPropagation();
          cb.onResetPartColors();
        },
      });
      pal.appendChild(reset);
    };

    const options = colorOptionsFor(colorMode, limitedColors, customColors);

    // Letter blocks print in exactly three filaments — the blocks, the caps, and the
    // legends — so the palette is those three rows, not one per letter.
    if (blocks) {
      pal.append(paletteRow('Body', rgbHex(bodyColorRgb), options, (hex) => cb.onBodyColor(hex)));
      pal.append(paletteRow('Caps', rgbHex(blocks.capRgb), options, (hex) => cb.onCapColor(hex)));
      pal.append(
        paletteRow('Letters', rgbHex(palette[0]?.filamentRgb ?? [247, 247, 245]), options, (hex) =>
          cb.onFilament(0, hex),
        ),
      );
      appendTip('Tip: click a block, a cap or a letter on the 3D model to recolor it.');
      return;
    }

    // ALWAYS render the Clicker Body row.
    pal.append(paletteRow('Body', rgbHex(bodyColorRgb), options, (hex) => cb.onBodyColor(hex)));

    if (palette.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'hint';
      hint.textContent = 'Load an image/vector to pick colors.';
      pal.appendChild(hint);
    } else {
      palette.forEach((entry, i) => {
        pal.append(
          paletteRow(`Color ${i + 1}`, rgbHex(entry.filamentRgb), options, (hex) => cb.onFilament(i, hex), rgbHex(entry.quantRgb)),
        );
      });

      appendTip('Tip: click a shape on the 3D model to recolor just that shape. A row above recolors its whole color.');
    }
  }

  /* Audit #21: the bucket-vs-shape explanation above only reaches someone who reads the
   *  static hint under the list. Toasting it once, the first time any palette chip is
   *  clicked, puts it in front of everyone else — then never again, the same one-shot
   *  `localStorage` guard the quality callout uses (and the same try/catch: a host that
   *  blocks storage should still work, just without the "don't ask again" memory). Delegated
   *  on the container rather than attached per-row, because `renderPalette` rebuilds every
   *  row's markup on each render and a listener on the row itself would need re-attaching
   *  every time. */
  try {
    if (localStorage.getItem('clicker-recolor-tip') !== 'shown') {
      const onFirstPaletteClick = (e: MouseEvent) => {
        if (!(e.target as HTMLElement).closest('.vl-color-chip')) return;
        $('palette').removeEventListener('click', onFirstPaletteClick);
        toast('Click a shape on the 3D model to recolor just that shape. A row above recolors its whole color.');
        try { localStorage.setItem('clicker-recolor-tip', 'shown'); } catch {}
      };
      $('palette').addEventListener('click', onFirstPaletteClick);
    }
  } catch {}

  /* The most recent state, for the handful of controls that need it at CLICK time rather
     than at sync time — the shape picker opens with the knobs the app has right now, and a
     drawer that opened on stale values would silently reset them on its first repaint. */
  function update(state: UiState) {
    latestState = state;
    statusEl.innerHTML = (state.building ? '<span class="spinner"></span> ' : '') + state.status;
    markLoadedSample(state.loadedSampleId);

    // Limited mode can land on a count outside the fixed 2-12 list (a pack's own colour
    // budget), so it gets a synthetic option layered on top via `setFieldOptions()` — the
    // same "list itself changes" case the kit built that for — rather than a value the field
    // silently refuses to show.
    /* Never disabled. The wizard's kept-colour list arrives as "limited" mode, and this used
       to grey the count out for it — "colors are greyed out if I want to increase the amount,
       let's not restrict users here". Picking a count here now leaves the kept list behind
       and re-splits the picture automatically (see `onColorCount`); the option that names
       the kept count exists only so the field can show it. */
    const countStr = String(state.colorCount);
    setFieldOptions(
      ccountField,
      state.colorMode === 'limited' && !COLOR_COUNT_OPTIONS.some((o) => o.value === countStr)
        ? [...COLOR_COUNT_OPTIONS, { value: countStr, label: `${state.colorCount} Colors (from image)` }]
        : COLOR_COUNT_OPTIONS,
      countStr,
    );

    /* One call each now. These used to be pairs — the range's `.value` and a separate
       `setVal()` writing the text box — which is two places to keep in step. `setValue()`
       moves both, and skips the box write while it has focus so a rebuild cannot fight
       typing — the guard every app used to carry by hand now lives in the component. */
    smoothRow.setValue(state.smoothing);
    widthRow.setValue(state.capWidthMm);
    topthickRow.setValue(state.topThickness);
    imgdepthRow.setValue(state.imageDepth);
    capProudRow.setValue(RIM_SPAN - state.capProud);
    hollowToggle.setValue(state.hollowBase);
    lastBuiltBody = state.builtBodyMm;
    designScaleRow.setValue(Math.round((state.designScale ?? 1) * 100));
    // An outline base ignores it, so the control must not sit there looking live. In Text
    // mode "Text size" is the same knob under a name that means something there, so this
    // one goes away entirely rather than being a second control fighting it.
    designScaleRow.hidden = state.importMode === 'text';
    designScaleRow.setDisabled(isOutlineBase(state));
    fixedSizeToggle.setValue(!!state.fixedSize);
    (document.getElementById('fixedSizeFields') as HTMLElement | null)?.toggleAttribute('hidden', !state.fixedSize);
    if (state.fixedSize) {
      fixedWRow.setValue(state.fixedSize.w);
      fixedHRow.setValue(state.fixedSize.h);
    }
    // Size and the lock are two answers to one question, so only one of them is ever live.
    // Leaving both enabled is how the slider went on looking functional while doing nothing.
    widthRow.setDisabled(!!state.fixedSize);
    gapTolRow.setValue(state.tolerance);
    stemFitRow.setValue(state.stemFitPct);
    socketFitRow.setValue(state.socketFitPct);
    const switchCountN = state.switches.length;
    const activeIdx = Math.min(state.activeSwitchIndex, switchCountN - 1);
    const active = state.switches[activeIdx] ?? { x: 0, y: 0, rotation: 0 };
    {
      const bits: string[] = [];
      if (Math.abs(active.x) >= 0.05 || Math.abs(active.y) >= 0.05) {
        bits.push(`X ${active.x > 0 ? '+' : ''}${active.x.toFixed(1)} · Y ${active.y > 0 ? '+' : ''}${active.y.toFixed(1)} mm`);
      }
      if (Math.abs(active.rotation) >= 0.5) bits.push(`${active.rotation > 0 ? '↺' : '↻'} ${Math.abs(active.rotation)}°`);
      const body = bits.length ? bits.join('  ·  ') : 'Centered';
      switchDpad.setReadout(switchCountN > 1 ? `S${activeIdx + 1} · ${body}` : body);
    }
    // Switch count segmented control.
    switchCountTabs.setValue(String(switchCountN) as '1' | '2' | '3');
    // Active-switch chips (only shown for 2–3 switches). S2/S3 are hidden rather than rebuilt,
    // so there is no count to reconcile against a rendered button list any more.
    const chipsMountEl = document.getElementById('switchChipsMount');
    if (chipsMountEl) {
      chipsMountEl.style.display = switchCountN > 1 ? 'block' : 'none';
      activeSwitchTabs.setOptionVisible('1', switchCountN >= 2);
      activeSwitchTabs.setOptionVisible('2', switchCountN >= 3);
      activeSwitchTabs.setValue(String(activeIdx) as '0' | '1' | '2');
    }
    const resetAllEl = document.getElementById('switchResetAll');
    if (resetAllEl) resetAllEl.style.display = switchCountN > 1 ? 'block' : 'none';
    const kc = state.keychain;
    keychainToggle.setValue(kc.enabled);
    const kcOpts = document.getElementById('keychainOpts');
    if (kcOpts) kcOpts.style.display = kc.enabled ? '' : 'none';

    keychainAngleRow.setValue(kc.angleDeg ?? 90);
    keychainOffsetRowCtl.setValue(kc.offsetMm ?? 0);
    keychainHoleLast = kc.holeDiameterMm;
    keychainSizeRow.setValue(kc.holeDiameterMm);
    removeBgToggle.setValue(state.removeBg);
    removeBgSvgToggle.setValue(state.removeBg);
    showSwitchToggle.setValue(state.showSwitch);

    // Update Import Mode tabs and panels
    importTabsCtl.setValue(state.importMode);
    const isBlockMode = state.importMode === 'blocks';
    $('imagePanel').hidden = state.importMode !== 'image';
    $('svgPanel').hidden = state.importMode !== 'svg';
    $('iconPanel').hidden = state.importMode !== 'icon';
    // Text and Blocks share one panel — both are "type something, pick a font".
    $('letterPanel').hidden = state.importMode !== 'text' && !isBlockMode;
    $('blocksChainField').hidden = !isBlockMode;
    $('blocksSection').hidden = !isBlockMode;
    $('textOnlyField').hidden = isBlockMode;
    $('textSection').hidden = state.importMode !== 'text';
    // Both boxes live in the shared panel; each shows only in its own mode. (The Blocks
    // box used to be unhidden on the way in and never hidden on the way back out, so
    // Text mode showed two text fields.)
    $('blocksTextField').hidden = !isBlockMode;
    if (!isBlockMode) {
      textScaleRow.setValue(Math.round(state.textScale * 100));
      textBoldRow.setValue(state.textBold);
      letterSpacingRow.setValue(state.letterSpacing);
      lineSpacingRow.setValue(state.lineSpacing);
    }
    const keycapLink = document.getElementById('blocksKeycapLink');
    if (keycapLink) keycapLink.hidden = !isBlockMode;
    if (isBlockMode) {
      renderBlockChips(state.blockSlots);
      // Keep the box in step when chips are deleted in the row below it.
      if (document.activeElement !== blocksTextEl) {
        blocksTextEl.value = state.blockSlots
          .filter((s): s is { kind: 'char'; ch: string } => s.kind === 'char')
          .map((s) => s.ch)
          .join('');
      }
      blockOrientTabs.setValue(state.blockOrientation);
      legendSizeRow.setValue(state.legendScale);
      legendBoldRow.setValue(state.legendBold);
      blockSideTabs.setValue(state.keychainEnd);
      keychainSlideRow.setValue(state.keychainSlideMm ?? 0);
    }

    // Hide/show image specific fields in colors section
    const showSmoothingAndBg = state.importMode === 'image';
    // Named `...Wrap`, not `ccountField` — that name is the selectField() control itself now
    // (declared above, outside `update()`); this is only the wrapper div around its mount.
    const ccountFieldWrap = $('colorCountField');
    const smoothingField = $('smoothingField');
    if (ccountFieldWrap) ccountFieldWrap.style.display = showSmoothingAndBg ? 'grid' : 'none';
    if (smoothingField) smoothingField.style.display = showSmoothingAndBg ? 'grid' : 'none';

    // Update Shape controls. Icons can't use the outline style (their thin
    // line-art makes a broken body), so the Outline tab is hidden for icon mode
    // and the body is always a solid shape.
    shapeTypeTabs.setOptionVisible('outline', state.importMode !== 'icon');
    const treatAsOutline = isOutlineBase(state);
    $('shapeSelectField').style.display = treatAsOutline ? 'none' : 'block';
    // Moving the design only applies to a preset shape: on an outline base the shape IS
    // the design, so there is nothing to move it against.
    const showNudge = !treatAsOutline && !isBlockMode;
    $('imageNudgeField').style.display = showNudge ? '' : 'none';
    if (showNudge) {
      const { x, y } = state.imageOffset;
      const signed = (v: number) => (v > 0 ? '+' : '') + v.toFixed(1);
      imageDpad.setReadout(x === 0 && y === 0 ? 'Centered' : `${signed(x)}, ${signed(y)} mm`);
    }

    // Blocks mode: the block shells are fixed CAD parts, so everything that shapes a
    // free-form clicker body (base style, size, keychain angle, backing thickness, legend
    // depth, the socket fit and the switch layout) has nothing to act on and is hidden.
    // What stays is what still means something: the stem fit and the palette.
    const hideForBlocks = (el: HTMLElement | null) => {
      if (el) el.style.display = isBlockMode ? 'none' : '';
    };
    hideForBlocks(document.getElementById('baseStyleSection'));
    // By MOUNT id, not by the id of whatever the mount happens to contain. The three lookups
    // that used to live here asked for `topthick`, `imgdepth` and `socketTolStepper`: the first
    // two never existed at all, and the third stopped existing when the fit controls were
    // renamed. `undefined?.closest()` is a silent no-op, so each one quietly stopped hiding its
    // row and left a control on screen that `buildBlocks` does not read — it moves, it prints a
    // number, and it changes nothing. This is CLAUDE.md's "grep for the container, not just the
    // buttons" a second time, so these now name the mounts, which are the things the markup
    // actually declares and which `$()` would have thrown on.
    /* What blocks mode genuinely has no use for.

       `socketFitMount` and `fitTestMount` came OFF this list on 2026-09-03. Both are about the
       switch, and a block holds a switch exactly as the flat clicker does: `stemFitPct` already
       drove the keycap's grip (and was never hidden), and `socketFitPct` now resizes the
       block's pocket too. Hiding them meant a switch that was tight in a block could not be
       fixed at all, and the printable fit test — whose whole job is answering "what number do
       I type" for that grip — was unreachable from the mode that needs it just as much.

       `gapTolMount` stays hidden and should: it is the cap-to-body slip fit of the flat
       clicker's well, and a block has no well — its keycap sits on a stem. */
    for (const mount of ['topthickMount', 'imgdepthMount', 'capProudMount', 'hollowMount', 'gapTolMount']) {
      hideForBlocks(document.getElementById(mount)?.closest('.prow-stacked') as HTMLElement | null);
    }
    // The keychain stays, but a block set has no round edge to slide a loop around, so it
    // welds to one side of the set instead — Side + Slide show, Angle + Offset hide, and
    // each pair gets its own Reset since they write different fields.
    const showForBlocks = (el: HTMLElement | null) => {
      if (el) el.style.display = isBlockMode ? '' : 'none';
    };
    showForBlocks(document.getElementById('keychainEndField'));
    showForBlocks(document.getElementById('keychainSlideRow'));
    showForBlocks(document.getElementById('keychainBlockResetMount'));
    hideForBlocks(document.getElementById('keychainAngleRow'));
    hideForBlocks(document.getElementById('keychainOffsetRow'));
    hideForBlocks(document.getElementById('keychainFreeResetMount'));
    hideForBlocks(document.getElementById('sectionSwitch'));

    shapeTypeTabs.setValue(treatAsOutline ? 'outline' : 'shape');

    if (treatAsOutline) {
      shapeBtn.setDisabled(true);
    } else {
      shapeBtn.setDisabled(false);
    }
    /* The button names the shape you have, which is the job the `<select>` used to do and the
       one thing a "Choose a shape" button would otherwise fail at. A pack or library shape is
       stored as its token rather than as 'custom' — 'custom' names the mechanism and there are
       hundreds of them, so it would leave the button reading "Custom" forever. */
    const entry = entryForState(state.baseShape, state.packShapeToken);
    if (entry) lastShapeId = entry.id;
    // A shape drawn in the editor is not in the directory and never will be, so it has no
    // entry and no name — say so rather than falling back to "Choose a shape", which would
    // read as though nothing had been chosen.
    shapeBtn.setLabel(
      entry ? entry.name : state.baseShape === 'custom' ? 'Your shape' : 'Choose a shape',
    );

    // Update View tabs. This loop used to query `'button'` and key off `dataset.view`; once
    // the row became a `segmentedControl()` its buttons carry no such attribute, so the
    // comparison was false for every tab and it stripped `.active` off all of them — the
    // label kept `--muted` grey while the indicator pill painted accent behind it, 1.03:1.
    viewTabs.setValue(state.view);

    // The export button lives in the ui-kit sidebar footer now; guard in case it
    // isn't present. cb.onExport() also no-ops when there are no parts.
    const exportBtn = $<HTMLButtonElement>('export');
    if (exportBtn) exportBtn.disabled = !state.hasParts || state.building;

    // Toggle loading overlay
    const overlay = $('loadingOverlay');
    if (overlay) {
      if (state.building) {
        overlay.removeAttribute('hidden');
        const textEl = overlay.querySelector('.loading-text');
        if (textEl) {
          textEl.textContent = state.status;
        }
      } else {
        overlay.setAttribute('hidden', '');
      }
    }

    renderPalette(
      state.palette,
      state.bodyColorRgb,
      state.colorMode,
      state.limitedColors,
      isBlockMode ? { capRgb: state.baseColorOverride ?? DEFAULT_CAP_RGB } : undefined,
      Object.keys(state.partOverrides ?? {}).length,
      state.customColors ?? [],
    );

    // Highlight the active icon in the Lucide gallery
    if (state.currentIconName) {
      galleryEl.querySelectorAll('.icon').forEach((n) => {
        n.classList.toggle('active', n.getAttribute('title') === state.currentIconName);
      });
    }

    editModes?.setValue(state.editMode);

    // --- Undo / redo / refresh toolbar ---
    undoBtn.setDisabled(!state.canUndo);
    redoBtn.setDisabled(!state.canRedo);
    refreshBtn.setDisabled(!state.canRefresh);

    // --- Extrude tooltip ---
    const extrudeTooltipEl = document.getElementById('extrudeTooltip');
    if (extrudeTooltipEl) {
      extrudeTooltipEl.classList.toggle('hidden', state.editMode !== 'extrude');
    }

    // --- Separate-letters toggle: text mode only, in Color + Extrude ---
    const lettersToggleEl = document.getElementById('lettersToggle');
    if (lettersToggleEl) {
      const showLetters = state.importMode === 'text'
        && (state.editMode === 'color' || state.editMode === 'extrude');
      lettersToggleEl.toggleAttribute('hidden', !showLetters);
      separateLettersToggle?.setValue(state.separateLetters);
    }

    // --- Extrude panel ---
    const extrudePanelEl = document.getElementById('extrudePanel');
    if (extrudePanelEl) {
      if (state.editMode === 'extrude') {
        extrudePanelEl.removeAttribute('hidden');
        const selCountHint = extrudePanelEl.querySelector('#extrudeSelCountHint');
        // Global, part-independent toggle: always reflects the single flag.
        extrudeChamferToggle?.setValue(state.extrudeChamfer);

        if (state.selectedParts.length === 0) {
          extrudeLevelRow?.setDisabled(true);
          if (selCountHint) selCountHint.textContent = 'Select a part to raise or lower it.';
        } else {
          extrudeLevelRow?.setDisabled(false);
          const firstPart = state.selectedParts[0];
          const level = state.componentHeights[firstPart] ?? 0;
          extrudeLevelLast = level;
          extrudeLevelRow?.setValue(level);
          const n = state.selectedParts.length;
          if (selCountHint) selCountHint.textContent = n > 1 ? `${n} parts selected` : '';
        }
      } else {
        extrudePanelEl.setAttribute('hidden', '');
      }
    }

    // --- Edges panel (floating): per-part edges only. Global cap/base edges now live
    //     in the left sidebar, so with nothing selected we just prompt to pick a part. ---
    const edgesPanelEl = document.getElementById('edgesPanel');
    const edgesContentEl = document.getElementById('edgesContent');
    // The text-bearing span inside the title, not the title bar itself — the bar also holds
    // the help tip added at construction, which a `.textContent =` on the bar would wipe out.
    const edgesTitleEl = document.getElementById('edgesTitleText');
    if (edgesPanelEl && edgesContentEl && edgesTitleEl) {
      if (state.editMode === 'edges') {
        edgesPanelEl.removeAttribute('hidden');

        if (state.selectedParts.length === 0) {
          edgesTitleEl.textContent = 'Edge Modifications';
          if (!edgesContentEl.querySelector('.edges-empty')) {
            edgesContentEl.innerHTML =
              `<div class="edges-empty">Click a part on the model to round or bevel its top edge.<br/>Cap &amp; base edges are in the left panel, under <strong>Shape &amp; Size</strong>.</div>`;
          }
        } else {
          const targets = state.selectedParts;
          edgesTitleEl.textContent = 'Part Edges';

          // Rebuild only if the selection changed. The style row for each target is a
          // segmentedControl() now rather than a `.edge-style-btn` triple in an HTML string,
          // so what has to survive a rebuild is the map from target to its live handle —
          // `partEdgeRows`, populated below — not a DOM query for a data attribute.
          const currentTargets = Array.from(partEdgeRows.keys());
          if (targets.join(',') !== currentTargets.join(',')) {
            edgesContentEl.innerHTML = '';
            partEdgeRows.clear();
            for (const t of targets) {
              const radiusLabelEl = document.createElement('span');
              radiusLabelEl.className = 'edge-radius-label';
              radiusLabelEl.style.color = 'var(--muted)';
              const labelRow = document.createElement('div');
              labelRow.className = 'edge-label';
              labelRow.title = t;
              labelRow.style.marginBottom = '4px';
              labelRow.append(`${friendlyTargetLabel(t)} `, radiusLabelEl);

              const tabs = edgeStyleTabs(t, 'none');
              const tabsWrap = document.createElement('div');
              tabsWrap.style.marginBottom = '8px';
              tabsWrap.append(tabs);

              const sizeRow = document.createElement('div');
              sizeRow.className = 'edge-size-btns';
              sizeRow.dataset.edge = t;
              sizeRow.style.cssText = 'gap:8px; margin-bottom: 12px; display: none;';
              sizeRow.innerHTML = `
                <button class="btn edge-size-minus" type="button" style="flex:1;">-</button>
                <button class="btn edge-size-plus" type="button" style="flex:1;">+</button>
              `;

              edgesContentEl.append(labelRow, tabsWrap, sizeRow);
              partEdgeRows.set(t, { tabs, sizeRow, radiusLabelEl });
            }
          }

          // Sync from edgeSettings.
          for (const target of targets) {
            const es = state.edgeSettings.find(s => s.target === target) || { target, style: 'none' as EdgeStyle, radius: 1.0 };
            const row = partEdgeRows.get(target);
            if (!row) continue;
            row.tabs.setValue(es.style);
            if (es.style === 'none') {
              row.sizeRow.style.display = 'none';
              row.radiusLabelEl.textContent = '';
            } else {
              row.sizeRow.style.display = 'flex';
              const safeRadius = es.radius !== undefined ? es.radius : 1.0;
              row.radiusLabelEl.textContent = `(${safeRadius.toFixed(1)} mm)`;
            }
          }
        }
      } else {
        edgesPanelEl.setAttribute('hidden', '');
      }
    }
  }

  return { 
    update, 
    hexRgb, 
    showColorPopoverAt, 
    addUploadedSvg, 
    /**
     * Undoes everything this UI put outside its two sidebars.
     *
     * The selector sweep at the end is for the transient overlays — a colour popover, the
     * welcome modal, a tutorial card — which each already remove themselves on close, but
     * only if the user ever closes them. Unmounting mid-modal has to clear them too.
     */
    dispose: () => {
      for (const fn of cleanups.reverse()) {
        try { fn(); } catch { /* one failure must not strand the rest */ }
      }
      cleanups.length = 0;
      for (const sel of ['.slot-editor', '.vl-overlay', '.vl-license-toast']) {
        document.querySelectorAll(sel).forEach((n) => n.remove());
      }
    },
    addFontOption: (font: FontOption) => { 
      addFontOption(font); 
      // Click the newly added font to select it
      const lastBtn = fontGrid.lastElementChild as HTMLElement;
      if (lastBtn) lastBtn.click();
    } 
  };
}
