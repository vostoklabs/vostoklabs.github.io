import { BRAND } from '@vostok/brand';
import {
  button,
  colorChip,
  dialog,
  helpTip,
  historyControls,
  type HistoryControlsHandle,
  iconButton,
  modeBar,
  selectField,
  thumbTile,
  toggleSwitch,
  type ValueRow,
  dpad,
  generatorHeader,
  ICONS,
  qualityCallout,
  segmentedControl,
  type SegmentedRow,
  setExportNote,
  setFieldOptions,
  panelCredit,
  sidebarFooter,
  sampleGrid,
  type SampleGridHandle,
  sliderRow,
  stepperRow,
  makeCollapsible,
  previewBar,
  type PreviewBar,
  slider,
  stageRow,
  stageTools,
  fontChooser,
  type FontChooserHandle,
  type FontPickerFont,
  type DesktopHost,
  keyMap,
  settingsRail,
  toast,
} from '@vostok/ui-kit';
import { MAKERLAB, SELLER_PACK, isUnlocked } from 'virtual:makerlab';
import type { BaseShapeKind, BlockStyle, BlockTexture, KeychainSide, EditMode, EdgeSetting, EdgeStyle, KeychainParams, PaletteEntry, SwitchPlacement, ViewMode, RGB } from '../types';
import { FILAMENTS } from '../types';
import type { SectionAxis } from '../viewer/viewer';
import { SAMPLES } from '../image/sample';
import type { RgbaImage } from '@vostok/trace';
import { facesThatWrite, fontWritesText, STANDARD_FONTS } from '../image/letter';
import { FONTS, curatedFonts, getRequiredSubsets, toPickerFont } from '@vostok/fonts';
import { LUCIDE_ICONS, buildSvg, svgDataUrl } from '../image/lucideIcons';
import { CHANGELOG } from '../changelog';
import { entryForState, loadPackShapes } from '../shapes/directory';
import { designUrl, inSeason, loadDesignImage, orderedDesignPacks } from '../packs';
import { openShapePicker } from './shapePicker';
import { STEM_FIT_MAX_MM, STEM_FIT_MIN_MM, STEM_FIT_STEP_MM } from '../geometry/stemFit';
import { FIT_TEST_STEP_OPTIONS } from '../geometry/fitStrip';
import type { ModelCutParams, ModelInfo, ModelMeta } from '../model/types';
import { modelFormatOf } from '../model/parse';
import { arrangeBlocks, GRID_MAX, isLineLayout, keysPerRow, type BlockArrangement, type BlockLayout, type BlockSymbol } from '../geometry/blockLayout';
import { assetUrl } from '../assets';
import { lookOf, lookRings } from '../image/symbolRings';
import { lucideImg, ringsSvg } from './symbols';
import { symbolLines, type LineSpec } from './symbolLines';
import { fmtSignedMm, readSigned } from './signedReadout';

/** Fallback swatch for the keycap row before the build derives a contrasting frame. */
const DEFAULT_CAP_RGB: RGB = [240, 240, 240];

/** The left panel's categories, in rail order. Which ones a mode shows: `RAIL_FOR_MODE`. */
type RailId = 'layout' | 'shape' | 'cut' | 'model' | 'font' | 'lettering' | 'body' | 'colors' | 'switch' | 'keychain' | 'fit' | 'seller';

/** The licence and the seller tools: a category of their own, set apart at the end of the rail
 *  in every mode. Only the MakerWorld build has anything to put in it. */
const SELLER: RailId[] = MAKERLAB ? ['seller'] : [];

/** The categories each source has, and the one it opens on — the knob that makes the clicker
 *  that kind of clicker, never the font (Laser Studio's rule). The design comes first and Fit,
 *  which is about your printer and your switches rather than the design, comes last. */
const RAIL_FOR_MODE: Record<UiState['importMode'], { show: RailId[]; first: RailId }> = {
  image: { show: ['shape', 'body', 'colors', 'switch', 'keychain', 'fit', ...SELLER], first: 'shape' },
  svg: { show: ['shape', 'body', 'colors', 'switch', 'keychain', 'fit', ...SELLER], first: 'shape' },
  icon: { show: ['shape', 'body', 'colors', 'switch', 'keychain', 'fit', ...SELLER], first: 'shape' },
  text: { show: ['shape', 'font', 'lettering', 'body', 'colors', 'switch', 'keychain', 'fit', ...SELLER], first: 'shape' },
  blocks: { show: ['layout', 'font', 'lettering', 'body', 'colors', 'keychain', 'fit', ...SELLER], first: 'layout' },
  model: { show: ['cut', 'model', 'colors', 'fit', ...SELLER], first: 'cut' },
};

/**
 * The Layout tiles' pictures: the keys of each arrangement, drawn as squares. An image (the
 * kit's picture tiles take a URL), so it cannot follow the theme's text colour — a mid grey
 * that reads on both the light and the dark panel instead.
 */
function layoutPicture(layout: BlockLayout): string {
  const T: [number, number, string?][] = [[1, 0], [0, 1], [1, 1], [2, 1]];
  const cells: [number, number, string?][] =
    layout === 'row' ? [[0, 0], [1, 0], [2, 0], [3, 0]]
    : layout === 'column' ? [[0, 0], [0, 1], [0, 2]]
    : layout === 'grid' ? [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => [c, r] as [number, number]))
    : layout === 'wasd' ? [[1, 0, 'W'], [0, 1, 'A'], [1, 1, 'S'], [2, 1, 'D']]
    : layout === 'arrows' ? T.map(([c, r], i) => [c, r, ['M0-3l3 4h-6z', 'M-3 0l4-3v6z', 'M0 3l3-4h-6z', 'M3 0l-4-3v6z'][i]])
    : [[0, 0], [1, 0], [2, 0, '+'], [0, 1, '+'], [1, 1], [2, 1], [0, 2], [1, 2, '+'], [2, 2]];
  const S = 20, G = 5, P = S + G;
  const cols = Math.max(...cells.map(([c]) => c)) + 1;
  const rows = Math.max(...cells.map(([, r]) => r)) + 1;
  const ox = (120 - (cols * P - G)) / 2;
  const oy = (100 - (rows * P - G)) / 2;
  const grey = '#8a94a6';
  const parts = cells.map(([c, r, mark]) => {
    const x = ox + c * P, y = oy + r * P, cx = x + S / 2, cy = y + S / 2;
    if (mark === '+') {
      return `<rect x="${x}" y="${y}" width="${S}" height="${S}" rx="4" fill="none" stroke="${grey}" stroke-width="1.4" stroke-dasharray="3 2.5"/>`;
    }
    const key = `<rect x="${x}" y="${y}" width="${S}" height="${S}" rx="4" fill="${grey}" fill-opacity="0.32" stroke="${grey}" stroke-width="1.4"/>`;
    if (!mark) return key;
    if (mark.startsWith('M')) return key + `<path transform="translate(${cx} ${cy})" d="${mark}" fill="${grey}"/>`;
    return key + `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-family="sans-serif" font-size="11" font-weight="700" fill="${grey}">${mark}</text>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100">${parts.join('')}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

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
  /** Cap stem fit, mm of clearance on the cross hole that grips the switch. 0 = as authored. */
  stemFitMm: number;
  /** The preview and Export show the printable stem fit test instead of the design. The
   *  design itself is untouched; its controls are locked until this goes false again. */
  fitTestActive: boolean;
  /** Distance between neighbouring fit test tiles, mm. */
  fitTestStepMm: number;
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
  /** Whether the preview is cut open. Independent of `view`. */
  sectionOn: boolean;
  /** Which axis the cut runs along. Viewport state: never saved, never undone. */
  sectionAxis: SectionAxis;
  /** Where the section cut sits, -1..1 across the model's own bounding box (0 = middle). */
  sectionPos: number;
  /** 'blocks' = the letter-block chain (one block + switch + keycap per letter).
   *  'model' = an uploaded 3D model, cut round a switch (src/model/). */
  importMode: 'image' | 'svg' | 'icon' | 'text' | 'blocks' | 'model';
  /** Model mode: how the model is cut. Undoable and saved, like every design field. */
  modelCut: ModelCutParams;
  /** Model mode: what the import made of the file, or null before one is loaded. */
  modelInfo: ModelInfo | null;
  /** Model mode: what the last build reported — slider ranges, where the cut landed. */
  modelMeta: ModelMeta | null;
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
  /** The arrangement picked in Layout. */
  blockLayout: BlockLayout;
  /** Grid and Custom: how many rows and columns of cells. */
  blockGridRows: number;
  blockGridCols: number;
  /** Custom: which cells hold a key, row by row. Null until the map is first changed. */
  blockCells: boolean[] | null;
  /** What is printed on the keys: one line per row of keys (a row or a column uses the first). */
  blockLines: string[];
  /** The symbols those lines use, by their private-use character. */
  blockSymbols: Record<string, BlockSymbol>;
  /** Text mode's symbols, kept the same way: the text itself is the mount's `currentText`. */
  textSymbols: Record<string, BlockSymbol>;
  /** A wall between every key, or one open frame round them all. */
  blockStyle: BlockStyle;
  /** The outside of the block body. */
  blockTexture: BlockTexture;
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
  /* The three knobs of whichever parametric shape is picked. They fire from the picker,
     beside the shape. */
  onShapeSides(n: number): void;
  onShapeCorner(pct: number): void;
  onShapeArm(pct: number): void;
  /** Open the 2-D shape editor — changing a shape, or drawing one. CHOOSING one is the
   *  picker's job (`onShapePick`), which is a drawer rather than a modal. */
  onEditShape(): void;
  /** Show the printable stem fit test in the preview, in place of the design. Called after
   *  the user has confirmed it; Export then sends the test. */
  onFitTest(): void;
  /** Back from the fit test to the design. */
  onFitTestExit(): void;
  /** Distance between fit test tiles, mm. */
  onFitTestStep(mm: number): void;
  /** Top ↔ base slip fit, absolute mm (+ looser, − tighter). */
  onGapTolerance(mm: number): void;
  /** Cap stem fit, absolute mm of clearance on the cross hole (+ looser, − tighter grip). */
  onStemFit(mm: number): void;
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
  /** Turn the cut on or off. Separate from `onView` — the two are unrelated questions. */
  onSectionEnabled(on: boolean): void;
  onSection(axis: SectionAxis, pos: number): void;
  /** Handed straight to the footer's export panel, which waits for it and shows a rejection
   *  (Export refusing a build that failed) as a toast. */
  onExport(): Promise<void> | void;
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
   * Ask the host for a file, when it has a picker of its own.
   *
   * Returns null and does nothing when there is no host, which is the signal to fall
   * through to the hidden file input this UI already owns. One hook rather than a `host`
   * reference, because the UI has no business knowing what a host is.
   */
  pickFile?(kind: string, extensions: string[]): Promise<File | null>;
  onBodyColor(hex: string): void;

  // New callbacks for vector modes
  onImportMode(mode: UiState['importMode']): void;
  /** A 3D model file (STL, 3MF, OBJ) dropped anywhere on the window. */
  onModelFile(file: File): void;
  onSvgUpload(file: File): void;
  onSelectSvg(svgText: string, name: string): void;
  onSelectIcon(svgText: string, name: string): void;
  onTextChange(text: string): void;
  onFontSelect(fontId: string): void;
  /** Read a font the person brought: the faces it held, and the names of any that would not
   *  load. Throws when the file is not a font. */
  importFont(file: File): Promise<{ fonts: { id: string }[]; failed: string[] }>;
  /** The desktop host, when there is one, handed to the kit's font block: its import opens the
   *  host's own file picker. Nothing here calls it. */
  host?: DesktopHost;
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
  onBlockLayout(layout: BlockLayout): void;
  onBlockGridSize(rows: number, cols: number): void;
  /** A cell of the key map was tapped: add a key there, or take it away. */
  onBlockCell(index: number): void;
  /** The text of one row of keys changed. */
  onBlockLine(row: number, text: string): void;
  /** A symbol went in or out of the rows, or one was resized, moved, turned or swapped. */
  onBlockSymbols(next: Record<string, BlockSymbol>): void;
  /** The same for Text mode's lines. */
  onTextSymbols(next: Record<string, BlockSymbol>): void;
  onBlockStyle(style: BlockStyle): void;
  onBlockTexture(texture: BlockTexture): void;
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
  let history: HistoryControlsHandle;
  let editModes: ReturnType<typeof modeBar<EditMode>> | null = null;
  let lettersBar: PreviewBar | null = null;
  let extrudeChamferToggle: ValueRow<boolean> | null = null;
  let extrudeLevelRow: ValueRow<number> | null = null;
  /** What the Level stepper last reported, so its absolute readout can be turned back into
   *  the delta `onExtrudeStep` actually wants — see where it is built, below. */
  let extrudeLevelLast = 0;
  /** The source the rail last opened for, so arriving in a mode opens its first category once
   *  and later updates leave the open one alone. */
  let railMode: UiState['importMode'] | null = null;

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

  // Title only: the rail beneath it says what the tool does, and every line up here pushes the
  // rail's last categories off a laptop screen.
  const headerEl = generatorHeader({
    title: 'Clicker Generator',
    // The byline lives in the credit strip pinned at the foot of this panel (panelCredit,
    // below). Saying "Made by Vostok Labs" at both ends of one column is one time too many.
    hideCredit: true,
  });

  // The quality callout links to an external MakerWorld page. The embedded build has no
  // outbound links; the host owns navigation.
  const qualityEl = MAKERLAB ? null : qualityCallout({
    html: `For the best quality printed clicker, please use the print profile and instructions available on <a class="hint-link" href="${BRAND.urls.clickerListing}" target="_blank" rel="noopener">MakerWorld</a>.`,
    storageKey: 'clicker-quality-callout',
  });

  // Populate Left Sidebar. Laser Studio's layout: the title stays put at the top, the settings
  // sit behind a rail, one category at a time, and undo/redo is at the foot.
  //
  // `#licenceCtaMount` and `#proMount` are anchors and nothing else: in the MakerWorld build
  // mount.ts fills them, and in every other build they stay empty divs. The explanation lives
  // here rather than as an HTML comment inside the string, because a comment in a template
  // literal survives minification verbatim and ships in the public bundle's DOM.
  //
  // Until the licence is bought, "Unlock lifetime commercial licence" is pinned above the rail,
  // where it is always seen. Once it is held, it moves into the Seller/License category (a
  // category of its own, set apart at the end of the rail in every mode) as the licence card,
  // above the tools it unlocks. `update()` moves it.
  const leftScroll = document.createElement('div');
  leftScroll.className = 'vl-panel__scroll cg-left';
  leftScroll.innerHTML = `
    <div class="cg-left-top"><div id="licenceCtaMount"></div></div>
    <div data-rail="seller"><div id="proMount"></div>
      <p class="vl-hint" id="sellerModelNote" hidden>The maker’s mark goes on clickers made from an image, an SVG, an icon, text or blocks.</p>
    </div>
    <div data-rail="layout">
      <div id="blockLayoutMount"></div>
      <div class="cg-grid-size" id="blockGridSizeRow">
        <div id="blockRowsMount"></div>
        <div id="blockColsMount"></div>
      </div>
      <div id="blockKeyMapMount"></div>
      <div id="blockStyleMount"></div>
    </div>
    <div data-rail="shape">
      <div class="field" id="shapeTypeField">
        <label>Base style ${tip('Outline follows your image silhouette. Shape places the image on a preset base such as a circle or square.')}</label>
        <div id="shapeTypeTabsMount"></div>
      </div>
      <div class="field" id="shapeSelectField">
        <label>Base shape ${tip('The shape of the printed base.')}</label>
        <div id="shapePickMount"></div>
      </div>
      <div class="prow-stacked"><div id="widthMount"></div></div>
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
    <div data-rail="cut"><div id="modelCutMount"></div>
    </div>
    <div data-rail="model"><div id="modelBodyMount"></div>
    </div>
    <div data-rail="font"></div>
    <div data-rail="lettering">
      <div class="prow-stacked" id="legendSizeRow"><div id="legendSizeMount"></div></div>
      <div class="prow-stacked" id="legendBoldRow"><div id="legendBoldMount"></div></div>
      <div class="prow-stacked" id="textScaleRow"><div id="textScaleMount"></div></div>
      <div class="prow-stacked" id="textBoldRow"><div id="textBoldMount"></div></div>
      <div class="prow-stacked" id="letterSpacingRow"><div id="letterSpacingMount"></div></div>
      <div class="prow-stacked" id="lineSpacingRow"><div id="lineSpacingMount"></div></div>
    </div>
    <div data-rail="body">
      <div id="blockTextureMount"></div>
      <div class="prow-stacked"><div id="topthickMount"></div></div>
      <div class="prow-stacked"><div id="imgdepthMount"></div></div>
      <div class="prow-stacked"><div id="capProudMount"></div></div>
      <div class="prow-stacked"><div id="hollowMount"></div></div>
    </div>
    <div data-rail="colors">
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
      <div id="modelColoursMount"></div>
    </div>
    <div data-rail="fit">
      <div class="prow-stacked"><div id="gapTolMount"></div></div>
      <div class="prow-stacked"><div id="stemFitMount"></div></div>
      <div class="prow-stacked"><div id="socketFitMount"></div></div>
      <div class="prow-stacked" id="fitTestBlock">
        <p class="switch-pad-hint">Print a strip of test tiles, press each one onto a real switch, then set Switch stem fit to the number on the tile that fits.</p>
        <div id="fitTestMount"></div>
      </div>
    </div>
    <div data-rail="switch">
      <div class="field" id="switchCountField">
        <label>Switches ${tip('Use 1 to 3 MX switches for larger or wider designs, for more click points and stability. Each switch can be moved and rotated individually.')}</label>
        <div id="switchCountMount"></div>
      </div>
      <div id="switchChipsMount" style="display:none;"></div>
      <div class="field" id="switchPadField">
        <p class="switch-pad-hint">Move &amp; rotate the MX switch ${tip('Slide and rotate the selected MX switch away from the design centre. Handy when a switch doesn\'t sit neatly in the centre of your design.')}</p>
        <div id="switchPadMount"></div>
      </div>
      <button class="secondary" id="switchResetAll" type="button" style="display:none; width:100%;">Reset all switches</button>
    </div>
    <div data-rail="keychain">
      <div id="keychainMount"></div>
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
    <div class="sidebar-sticky-footer cg-left-foot"><div id="historyControls"></div></div>
  `;
  const leftTop = leftScroll.querySelector('.cg-left-top') as HTMLElement;

  /* The categories. Each one's top-level elements are its rows: the rail takes a category off
     when every row in it is hidden for the current mode, so a mode never opens on an empty
     tab. Which categories a mode has at all is decided in `update()` (RAIL_FOR_MODE).
     The rows are written once, above, inside `data-rail` holders, and moved into the rail
     here; the holders go. */
  const RAIL_ITEMS: { id: RailId; label: string; icon: string; title?: string; fill?: boolean; divider?: boolean }[] = [
    // No heading: the first row is "Layout", with its help, as Cut's is "How it clicks".
    { id: 'layout', label: 'Layout', icon: ICONS.grid, title: '' },
    { id: 'shape', label: 'Shape', icon: ICONS.maximize, title: 'Shape & size' },
    // No heading: the cut's own first row is "How it clicks", with its help.
    { id: 'cut', label: 'Cut', icon: ICONS.layers, title: '' },
    { id: 'model', label: 'Model', icon: ICONS.box },
    { id: 'font', label: 'Font', icon: ICONS.text, fill: true },
    { id: 'lettering', label: 'Lettering', icon: ICONS.sliders },
    { id: 'body', label: 'Body', icon: ICONS.pattern },
    { id: 'colors', label: 'Colors', icon: ICONS.droplet },
    { id: 'switch', label: 'Switch', icon: ICONS.target },
    { id: 'keychain', label: 'Keychain', icon: ICONS.link },
    { id: 'fit', label: 'Fit', icon: ICONS.ruler },
    // Set apart by a hairline: selling, not the design. The label may break after the slash.
    { id: 'seller', label: 'Seller/\u200bLicense', title: 'Seller / License', icon: ICONS.license, divider: true },
  ];
  const settings = settingsRail({
    label: 'Clicker settings',
    items: RAIL_ITEMS.map((it) => {
      const holder = leftScroll.querySelector(`[data-rail="${it.id}"]`) as HTMLElement;
      const body = [...holder.children];
      holder.remove();
      return { ...it, body };
    }),
  });
  settings.classList.add('cg-rail');
  leftTop.after(settings);
  resolveHelpTips(leftScroll);

  sidebarLeft.innerHTML = '';
  sidebarLeft.append(leftScroll);

  // The byline lives in a compact credit line pinned to the bottom-left in both builds, and
  // the embedded build simply drops the intro header. The host page already shows the app's
  // name, so nothing is lost there.
  if (!MAKERLAB) {
    leftTop.prepend(headerEl);
  }
  /** The licence: on top until it is bought, then the first thing in Seller/License. */
  function placeLicence() {
    // Not `$`: this first runs before that helper is declared further down.
    const cta = leftScroll.querySelector<HTMLElement>('#licenceCtaMount')!;
    const tools = leftScroll.querySelector<HTMLElement>('#proMount')!;
    if (MAKERLAB && isUnlocked(SELLER_PACK)) {
      if (cta.nextElementSibling !== tools) tools.before(cta);
    } else if (cta.parentElement !== leftTop) {
      leftTop.append(cta);
    }
    // The embedded build has no title here (the host shows the name), so once the licence has
    // moved down nothing is left above the rail.
    leftTop.hidden = !leftTop.children.length;
  }
  placeLicence();
  // The print-quality pointer belongs with printing: it heads the Fit category rather than
  // the panel, where four lines of it pushed the rail off the screen.
  if (qualityEl) settings.panel('fit')?.querySelector('.vl-section__body')?.prepend(qualityEl);

  // The credit strip: who made this, and what changed. Appended to the panel rather than to
  // `leftScroll`, so it is OUTSIDE `.vl-panel__scroll` and stays pinned instead of scrolling
  // away with the controls.
  //
  // This was `headerEl` with a local `.kc-credit-block` class demoting it by hand — a title
  // shrunk, a subtitle hidden and four colours restated, in app CSS. That demotion is now the
  // kit's `panelCredit()`, so it is a component the next generator gets by name rather than a
  // class ladder it has to remember (invariant #9). Updates rides in the strip for the same
  // reason it does in the keycap generator: it is the answer to "has my bug been fixed", a
  // question people ask rather than one to interrupt them with, and a full-width button among
  // the controls made it look like a step in the workflow.
  sidebarLeft.append(panelCredit({
    title: 'Clicker Generator',
    updates: { entries: CHANGELOG, title: 'Clicker updates' },
  }));

  // Populate Right Sidebar (Input Modes & Export)
  sidebarRight.innerHTML = '';
  const rightScroll = document.createElement('div');
  rightScroll.className = 'vl-panel__scroll';
  rightScroll.innerHTML = `
    <div class="section" id="importSourceSection">
      <span class="label">Import source ${tip('Make your clicker from a picture, an SVG, an icon, text, or a 3D model to cut.')}</span>
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
        <div class="field" id="textLinesField">
          <div class="cg-lines-head">
            <label>Text ${tip('Up to three lines. Add symbol puts an icon where the cursor is; click it in the text to size, move or swap it.')}</label>
            <div id="textAddSymbolMount"></div>
          </div>
          <div id="textLinesMount"></div>
          <div id="textAddLineMount"></div>
          <div id="textInspectorMount"></div>
        </div>

        <div class="field" id="blockLinesField" hidden>
          <div class="cg-lines-head">
            <label>Text ${tip('One character per key; in a grid a space leaves a key blank. Add symbol puts an icon on the key at the cursor; click it to size, move or swap it.')}</label>
            <div id="blockAddSymbolMount"></div>
          </div>
          <div id="blockLinesMount"></div>
          <div id="blockInspectorMount"></div>
        </div>
        ${MAKERLAB ? '' : `<p class="hint-text" id="blocksKeycapLink" hidden>
          Want more keycap options, like profiles, sizes, or your own SVG or photo on the
          cap? Use the <a class="hint-link" href="${BRAND.urls.keycapApp}" target="_blank" rel="noopener">Vostok Labs Keycap Generator</a>.
        </p>`}

      </div>

      <!-- Model Panel: filled by ui/modelPanel.ts (mounted from mount.ts) -->
      <div id="modelPanel" class="mode-panel" hidden></div>
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
    // Also true in the embedded build, where nobody owns them: the embedded build has no
    // download path, so it has no Save or Load. The kit then draws only the theme toggle.
    // This used to be done by removing "the first action row" after the fact, and when the
    // kit folded its two rows into one that took Light mode with it.
    hostOwnsProjects: MAKERLAB || cb.hostOwnsProjects,
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
  // The row itself is `@vostok/ui-kit`'s now. It was built here first; the carabiner then
  // needed the same three buttons and started deriving its own, which is the point at which a
  // pattern belongs in the kit rather than in whichever app happened to grow it.
  history = historyControls({
    onUndo: () => cb.onUndo(),
    onRedo: () => cb.onRedo(),
    onRefresh: () => cb.onRefresh(),
  });
  $('historyControls').append(history);

  /** The host's picker if there is one, the hidden input if there is not. */
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
  // With a host this opens the host's own picker. Without one it clicks the hidden input,
  // whose own change handler picks it up from there.
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
    if (modelFormatOf(f.name)) {
      cb.onModelFile(f);
    } else if (f.name.endsWith('.svg')) {
      cb.onSvgUpload(f);
    } else if (f.name.endsWith('.ttf') || f.name.endsWith('.otf') || f.name.endsWith('.json')) {
      void importDroppedFont(f);
    } else if (f.type.startsWith('image/')) {
      cb.onUpload(f);
    } else {
      // A PDF, a HEIC the browser won't decode, a folder — nothing here silently swallowed
      // it before; the app just sat there looking like the drop had not registered (audit #8).
      cb.onStatus("That file type isn't supported. Try an image, SVG, font, or an STL, 3MF or OBJ model.");
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

  // --- Text: a field per line, up to three, each holding symbols as well as letters ---
  const MAX_TEXT_LINES = 3;
  /** What `parseLetter` keeps of a line. */
  const TEXT_LINE_MAX = 15;
  let textLines = ['Custom', 'Text'];
  const textUi = symbolLines({
    placement: true,
    onSymbols: (next) => cb.onTextSymbols(next),
    onLine: (i, text) => {
      textLines[i] = text;
      cb.onTextChange(textLines.join('\n'));
    },
  });
  $('textAddSymbolMount').append(textUi.addButton);
  $('textLinesMount').append(textUi.lines);
  $('textInspectorMount').append(textUi.inspector);
  const addLineBtn = button({
    label: 'Add a line',
    icon: ICONS.plus,
    emphasis: 'ghost',
    onClick: () => {
      textLines.push('');
      renderTextLines();
      textUi.focus(textLines.length - 1);
    },
  });
  $('textAddLineMount').append(addLineBtn);
  function renderTextLines() {
    const specs: LineSpec[] = textLines.map((_, i) => ({
      label: `Line ${i + 1}`,
      maxLength: TEXT_LINE_MAX,
      ...(i > 0
        ? {
            onRemove: () => {
              textLines.splice(i, 1);
              renderTextLines();
              cb.onTextChange(textLines.join('\n'));
            },
          }
        : {}),
    }));
    textUi.setLines(specs, textLines);
    addLineBtn.hidden = textLines.length >= MAX_TEXT_LINES;
  }
  renderTextLines();

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
    parse: (typed) => typed / 100,
    onInput: (v) => cb.onLineSpacing(v),
  });
  $('lineSpacingMount').append(lineSpacingRow);
  /* --- Font: the kit's font block, as the name keychain has it. A grid of cards, every face
     drawn in your own text; "Browse all" for the whole library, with its style and Alphabet
     chips; the import under them. When the text is not Latin, the cards are the faces that
     write it. */
  const STANDARD_FAMILY = '"Helvetica Neue", Helvetica, Arial, sans-serif';
  let fontSample = 'Custom Text';
  /** What the text needs that Latin does not cover. The cards follow it. */
  let fontNeeds = '';
  const allFonts = (): FontPickerFont[] => [
    ...STANDARD_FONTS.map((f) => ({ id: f.id, label: f.name, family: STANDARD_FAMILY, category: f.category ?? 'Clean', scripts: ['Latin'] })),
    ...FONTS.map(toPickerFont),
  ];
  const fontWrites = (f: FontPickerFont, text: string) => fontWritesText(f.id, text);
  const cardsFor = (): string[] =>
    fontNeeds ? facesThatWrite(fontSample) : [...STANDARD_FONTS.map((f) => f.id), ...curatedFonts().map((f) => f.id)];
  function makeFontBlock(value: string): FontChooserHandle {
    return fontChooser({
      fonts: allFonts(),
      curated: cardsFor(),
      value,
      sample: fontSample,
      featuredLabel: fontNeeds ? 'Works with your text' : 'Popular',
      supports: fontWrites,
      fill: true,
      importAccept: '.ttf,.otf,.woff,.zip,.json',
      ...(cb.host ? { host: cb.host } : {}),
      onChange: (id) => cb.onFontSelect(id),
      onImport: async (file) => {
        const { fonts, failed } = await cb.importFont(file);
        const all = allFonts();
        return { fonts: fonts.map((x) => all.find((f) => f.id === x.id)).filter((f): f is FontPickerFont => !!f), failed };
      },
    });
  }
  let fontBlock = makeFontBlock('helvetiker-regular');
  settings.panel('font')?.querySelector('.vl-section__body')?.append(fontBlock);
  settings.refresh();
  function rebuildFontBlock() {
    const next = makeFontBlock(fontBlock.getValue());
    fontBlock.replaceWith(next);
    fontBlock = next;
  }
  /** The text the cards draw: the words, without the symbols (no font has those). */
  function setFontSample(text: string) {
    const sample = Array.from(text).filter((ch) => (ch.codePointAt(0) ?? 0) < 0xf0000).join('').replace(/\s+/g, ' ').trim() || 'Aa';
    if (sample === fontSample) return;
    fontSample = sample;
    const needs = getRequiredSubsets(sample).filter((n) => n !== 'latin-ext').sort().join(',');
    if (needs !== fontNeeds) {
      fontNeeds = needs;
      rebuildFontBlock();
    } else {
      fontBlock.setSample(sample);
    }
  }
  /** A font file dropped anywhere on the page: imported the way the block's own import does it. */
  async function importDroppedFont(file: File) {
    try {
      const { fonts, failed } = await cb.importFont(file);
      if (failed.length) toast(`Could not read ${failed.join(', ')}.`, { kind: 'warn' });
      const last = fonts[fonts.length - 1];
      if (!last) return;
      fontBlock.setFonts(allFonts(), cardsFor());
      fontBlock.setValue(last.id, true);
    } catch (err) {
      toast(`Could not read ${file.name}: ${(err as Error).message}`, { kind: 'error' });
    }
  }

  // --- Letter blocks: the arrangement, the walls, the texture, and the lines of keys -------
  /* Layout: the arrangement as pictures, the grid's size for Grid and Custom, and a map of the
     keys. Tapping the map adds or removes a key, which makes any arrangement a Custom one. */
  const LAYOUT_OPTIONS: { value: BlockLayout; label: string }[] = [
    { value: 'row', label: 'Row' },
    { value: 'column', label: 'Column' },
    { value: 'grid', label: 'Grid' },
    { value: 'wasd', label: 'WASD' },
    { value: 'arrows', label: 'Arrows' },
    { value: 'custom', label: 'Custom' },
  ];
  const blockLayoutCtl = segmentedControl<BlockLayout>({
    label: 'Layout',
    help: 'How the keys are arranged. Say what goes on each key in the right panel.',
    variant: 'tiles',
    columns: 3,
    options: LAYOUT_OPTIONS.map((o) => ({ ...o, image: layoutPicture(o.value) })),
    value: initial.blockLayout,
    onChange: (v) => cb.onBlockLayout(v),
  });
  $('blockLayoutMount').append(blockLayoutCtl);

  const blockRowsRow = stepperRow({
    label: 'Rows', min: 1, max: GRID_MAX, value: initial.blockGridRows,
    onInput: (v) => cb.onBlockGridSize(v, blockColsRow.getValue()),
  });
  const blockColsRow = stepperRow({
    label: 'Columns', min: 1, max: GRID_MAX, value: initial.blockGridCols,
    onInput: (v) => cb.onBlockGridSize(blockRowsRow.getValue(), v),
  });
  $('blockRowsMount').append(blockRowsRow);
  $('blockColsMount').append(blockColsRow);

  const blockKeyMap = keyMap({
    label: 'Keys',
    help: 'Tap a square to add a key there, or a key to take it away.',
    rows: 1, cols: 1, on: [true],
    onToggle: (i) => cb.onBlockCell(i),
  });
  $('blockKeyMapMount').append(blockKeyMap);

  const blockBordersToggle = toggleSwitch({
    label: 'Borders',
    help: 'A wall between every key. Off: one open frame round all of them, like a keyboard.',
    checked: initial.blockStyle !== 'open',
    onChange: (on) => cb.onBlockStyle(on ? 'walls' : 'open'),
  });
  $('blockStyleMount').append(blockBordersToggle);

  /* Body: the outside of the block body, each option a picture of a real one. */
  const TEXTURE_OPTIONS: { value: BlockTexture; label: string }[] = [
    { value: 'smooth', label: 'Smooth' },
    { value: 'knurl', label: 'Diamond' },
    { value: 'ribs', label: 'Ribs' },
    { value: 'flutes', label: 'Fluted' },
    { value: 'dots', label: 'Dots' },
    { value: 'chevron', label: 'Chevron' },
  ];
  const blockTextureCtl = segmentedControl<BlockTexture>({
    label: 'Outside texture',
    help: 'The pattern on the outside walls. It only adds to the wall, so the keys fit the same.',
    variant: 'tiles',
    columns: 2,
    options: TEXTURE_OPTIONS.map((o) => ({ ...o, image: assetUrl(`assets/textures/${o.value}.png`) })),
    value: initial.blockTexture,
    onChange: (v) => cb.onBlockTexture(v),
  });
  $('blockTextureMount').append(blockTextureCtl);

  /* The right panel: what is printed on the keys. A row or a column is one line of up to 24
     keys; a grid has a line per row of keys, as long as the row. Rebuilt only when the rows
     change shape, so typing never loses the caret. */
  const BLOCK_LINE_MAX = 24;
  /** The row of keys each field writes: a grid row with no keys gets no field. */
  let rowOfField: number[] = [];
  let lineShape = '';
  const blockUi = symbolLines({
    placement: false,
    onSymbols: (next) => cb.onBlockSymbols(next),
    onLine: (i, text) => cb.onBlockLine(rowOfField[i] ?? i, text),
  });
  $('blockAddSymbolMount').append(blockUi.addButton);
  $('blockLinesMount').append(blockUi.lines);
  $('blockInspectorMount').append(blockUi.inspector);
  const keysHint = (n: number) => `${n} ${n === 1 ? 'key' : 'keys'}`;
  function renderBlockLines(state: UiState, arr: BlockArrangement) {
    const lineLayout = isLineLayout(state.blockLayout);
    const counts = lineLayout ? [0] : keysPerRow(arr.grid);
    const rows = counts.map((keys, r) => ({ r, keys })).filter((x) => lineLayout || x.keys > 0);
    const shape = lineLayout ? state.blockLayout : counts.join(',');
    const values = rows.map(({ r }) => state.blockLines[r] ?? '');
    if (shape !== lineShape) {
      lineShape = shape;
      rowOfField = rows.map(({ r }) => r);
      blockUi.setLines(
        rows.map(({ r, keys }) => ({
          label: lineLayout ? (state.blockLayout === 'row' ? 'Row' : 'Column') : `Row ${r + 1}`,
          maxLength: lineLayout ? BLOCK_LINE_MAX : keys,
          overwrite: !lineLayout,
          hint: keysHint(lineLayout ? arr.slots.length : keys),
        })),
        values,
      );
    } else {
      blockUi.setValues(values);
      // A row or a column grows a key per character, so its count follows the typing.
      if (lineLayout) blockUi.setHint(0, keysHint(arr.slots.length));
    }
  }

  /** What each cell of the key map shows: the letter, a drawing of the symbol, or nothing. */
  function keyLegends(state: UiState, arr: BlockArrangement): (string | Element | null)[] {
    return arr.slots.map((slot) => {
      if (slot.kind === 'char') return slot.ch;
      if (slot.kind === 'icon') return lucideImg(slot.name);
      if (slot.kind === 'symbol') {
        const sym = state.blockSymbols[slot.char];
        return sym?.kind === 'rings' ? ringsSvg(lookRings(sym.rings, lookOf(sym)), 22) : null;
      }
      return null;
    });
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

    /* The stage's top-left: how the preview is shown (the bar, filled in below), then what a
       click on the model does with Separate letters beside it, then Cut it open's own settings
       while it is on. One `stageTools()` with a row each, so they stack instead of colliding. */
    const viewRow = stageRow([]);
    viewRow.id = 'stageViewRow';
    lettersBar = previewBar({
      label: 'Letters',
      toggles: [{
        id: 'letters',
        label: 'Separate letters',
        pressed: initial.separateLetters,
        title: 'Each letter becomes its own part, so you can pick and colour letters one at a time.',
        onToggle: (v) => cb.onSeparateLetters(v),
      }],
    });
    lettersBar.root.id = 'lettersToggle';
    lettersBar.root.hidden = true;
    const clickRow = stageRow([editModes.root, lettersBar.root]);
    const cutRow = stageRow([]);
    cutRow.id = 'stageCutRow';
    cutRow.hidden = true;
    viewport.appendChild(stageTools([viewRow, clickRow, cutRow]));
    // The tools take the label's slot.
    viewport.querySelector<HTMLElement>('.vl-stage__label')?.setAttribute('hidden', '');


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
    stacked: true,
    columns: 3,
    options: [
      { value: 'image', label: 'Image', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>' },
      { value: 'svg', label: 'SVG', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>' },
      { value: 'icon', label: 'Icon', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>' },
      { value: 'text', label: 'Text', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>' },
      { value: 'blocks', label: 'Blocks', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="6.5" height="10" rx="1.4"/><rect x="8.75" y="7" width="6.5" height="10" rx="1.4"/><rect x="15.5" y="7" width="6.5" height="10" rx="1.4"/></svg>' },
      { value: 'model', label: '3D model', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="M3 7l9 5 9-5"/><path d="M12 12v10"/></svg>' },
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
    label: 'Number of colors',
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
          /* The pill, in the MakerWorld build only. In the public build `MAKERLAB` is false
             (and the editor is not in the bundle at all, so this button is not drawn either).
             `isUnlocked` is presentation, which is exactly what a pill is. */
          paidBadge: MAKERLAB && !isUnlocked(SELLER_PACK) ? 'Pro' : undefined,
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
     names print as one product. */
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
    label: 'Image depth', help: 'How far the colored design is raised into the top surface, in mm.',
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
  //
  // It does not download anything. The strip replaces the design in the preview and Export
  // sends it, the way the keycap generator's fit test works: MakerLab's sandbox has no
  // downloads, so a button that saved a file straight away did nothing at all in the embed.
  // Because the Export button then means something else, it asks first.
  const fitTestOpenBtn = button({
    label: 'Print a fit test',
    emphasis: 'secondary',
    icon: ICONS.target,
    block: true,
    onClick: () => {
      dialog({
        title: 'Print a fit test?',
        content: 'Your clicker in the preview is swapped for a strip of five test tiles. While they are showing, Export sends the test tiles, not your clicker, and the other settings are locked. Your design is kept: press Back to my clicker to return to it.',
        actions: [
          { label: 'Cancel' },
          { label: 'Show the fit test', primary: true, onClick: () => { cb.onFitTest(); } },
        ],
      });
    },
  });
  const fitTestStepRow = segmentedControl({
    label: 'Fit test step',
    help: 'How far apart the tiles are. The middle tile is your current Switch stem fit. Print once at 0.10 mm, then again at 0.05 mm around the tile that fitted best.',
    options: FIT_TEST_STEP_OPTIONS.map((mm) => ({ value: mm.toFixed(2), label: `${mm.toFixed(2)} mm` })),
    value: initial.fitTestStepMm.toFixed(2),
    onChange: (v) => cb.onFitTestStep(Number(v)),
  });
  const fitTestBackBtn = button({
    label: 'Back to my clicker',
    emphasis: 'secondary',
    block: true,
    onClick: () => cb.onFitTestExit(),
  });
  $('fitTestMount').append(fitTestOpenBtn, fitTestStepRow, fitTestBackBtn);

  /* Everything that shapes the DESIGN is locked while the fit test is showing, so nothing can
     change a model nobody can see. What stays live is what applies to the tiles too: the stem
     fit, the fit test's own controls, the preview and view settings, and Export. `inert` is
     what stops them; `.vl-control--disabled` only says so. `rebuild()` in mount.ts backs this
     up: a design build that still gets requested takes the preview back to the design. */
  const fitLockTargets = (): HTMLElement[] => {
    const keep = new Set<Element | null | undefined>([
      $('stemFitMount')?.closest('.prow-stacked'), $('fitTestBlock'),
    ]);
    // Every row of every category, except the two the test tiles still answer to. The rail
    // itself stays live, so the Fit category can always be reached.
    const rows = [...settings.querySelectorAll('.vl-settings-rail__panel > .vl-section__body > *')]
      .filter((n) => !keep.has(n));
    return [
      ...new Set([$('licenceCtaMount'), ...rows]),
      $('historyControls')?.closest('.sidebar-sticky-footer'),
      rightScrollWrap, editModes?.root, $('lettersToggle'),
    ].filter((n): n is HTMLElement => n instanceof HTMLElement);
  };
  let fitLockOn = false;
  function syncFitTest(active: boolean) {
    fitTestOpenBtn.hidden = active;
    fitTestStepRow.hidden = !active;
    fitTestBackBtn.hidden = !active;
    if (active === fitLockOn) return;
    fitLockOn = active;
    for (const node of fitLockTargets()) {
      node.inert = active;
      node.classList.toggle('vl-control--disabled', active);
    }
    setExportNote(rightFooter, active ? 'Exports the fit test tiles, not your clicker.' : '');
  }

  /* --- The three fit controls ---------------------------------------------------------
     Every one of them reads 0 on a fresh design and 0 means the geometry that ships today,
     so nobody's working settings move. What changed is that each is now named after the pair
     of surfaces it actually moves. The old pair had one control labelled "Switch socket
     tolerance" that only ever set the cap-to-body gap, and one labelled in millimetres that
     moved the gripping slot by about a seventh of them — between them they produced both
     open fit complaints on the listing, from opposite directions.

     The pocket control is a percentage because what it scales is the whole cutter. The stem
     control is millimetres of clearance on the cross hole, because that is exactly what it
     moves. See `stemFitMm` in types.ts. */
  const pct = (v: number) => (v > 0.001 ? '+' : v < -0.001 ? '−' : '') + Math.abs(v).toFixed(1) + '%';

  const gapTolRow = stepperRow({
    label: 'Top / base gap',
    help: 'Clearance between the top part and the base it presses into. Press + if the two halves are hard to fit together or the top scrapes, − if they feel loose. 0 = the default fit.',
    min: 0.1, max: 1.0, step: 0.05, value: initial.tolerance,
    format: (v) => fmtSignedMm(v - BASE_SOCKET_TOL, 2),
    parse: (typed, raw) => readSigned(typed, raw) + BASE_SOCKET_TOL,
    onInput: (v) => cb.onGapTolerance(v),
  });
  $('gapTolMount').append(gapTolRow);

  const stemFitRow = stepperRow({
    label: 'Switch stem fit (top part)',
    help: 'How tightly the top part grips the stem of your MX switch. Press + if the top is hard to push on or the post splits, − for a firmer grip. Each step makes the cross hole 0.05 mm wider or narrower. 0 = as designed.',
    min: STEM_FIT_MIN_MM, max: STEM_FIT_MAX_MM, step: STEM_FIT_STEP_MM, value: initial.stemFitMm,
    format: (v) => fmtSignedMm(v, 2),
    parse: readSigned,
    onInput: (v) => cb.onStemFit(v),
  });
  $('stemFitMount').append(stemFitRow);

  const socketFitRow = stepperRow({
    label: 'Switch pocket fit (base)',
    help: 'How tightly the switch itself sits in the base. Press + if the switch is hard to push in, − if it rattles or falls out. 0 = as designed.',
    min: -5, max: 5, step: 0.5, value: initial.socketFitPct,
    format: pct,
    parse: readSigned,
    onInput: (v) => cb.onSocketFit(v),
  });
  $('socketFitMount').append(socketFitRow);

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
    label: 'Keyring loop',
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

  // --- How the preview is shown: one bar on the stage, the same in every mode ---
  // The arrangement as a pill pair, then the two preview-only switches as dots. Their
  // explanations are tooltips: the bar has no room for a "?".
  const viewTabs = previewBar<ViewMode>({
    label: 'Preview',
    modes: {
      options: [
        { value: 'assembled', label: 'Assembled' },
        { value: 'exploded', label: 'Exploded' },
      ],
      value: initial.view,
      onChange: (v) => cb.onView(v),
    },
    toggles: [
      {
        id: 'switch',
        label: 'Show MX switch',
        pressed: initial.showSwitch,
        title: 'Shows a reference MX switch in the preview so you can check the fit. It is not part of the exported model.',
        onToggle: (v) => cb.onShowSwitch(v),
      },
      {
        id: 'cut',
        label: 'Cut it open',
        pressed: initial.sectionOn,
        title: 'Slices the preview so you can see the switch sitting inside the body. Preview only: it never changes the exported file.',
        onToggle: (v) => cb.onSectionEnabled(v),
      },
    ],
  });
  document.getElementById('stageViewRow')?.append(viewTabs.root);

  /* The cut through the model: the bar's Cut it open, and its own settings on the row under
     it while it is on — which way the cut runs and how far along. A switch of its own rather
     than a third view, so either arrangement can be cut. Axis and position are viewport state,
     deliberately absent from HISTORY_FIELDS and from a saved project, like `view` and
     `showSwitch`: what a project reproduces is a model, not a camera. */
  let cutAxis: SectionAxis = initial.sectionAxis;
  const cutPos = slider({
    min: -100,
    max: 100,
    step: 2,
    value: Math.round(initial.sectionPos * 100),
    ariaLabel: 'Cut position',
    onInput: (v) => cb.onSection(cutAxis, v / 100),
  });
  cutPos.title = 'Slides the cut through the model. Preview only.';
  const cutBar = previewBar<SectionAxis>({
    label: 'Cut',
    modes: {
      label: 'Cut along',
      options: [
        { value: 'x', label: 'X' },
        { value: 'y', label: 'Y' },
        { value: 'z', label: 'Z' },
      ],
      value: initial.sectionAxis,
      onChange: (v) => {
        cutAxis = v;
        cb.onSection(v, Number(cutPos.value) / 100);
      },
    },
    extra: [cutPos],
  });
  document.getElementById('stageCutRow')?.append(cutBar.root);

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
  /* The status line is text, never markup: it carries file and project names. Built once and
     updated in place, so the spinner's animation does not restart on every repaint. */
  const statusSpinner = document.createElement('span');
  statusSpinner.className = 'spinner';
  const statusText = document.createTextNode('');
  statusEl.replaceChildren(statusSpinner, statusText);

  function update(state: UiState) {
    latestState = state;
    statusSpinner.style.display = state.building ? '' : 'none';
    statusText.data = (state.building ? ' ' : '') + state.status;
    // Nothing to say: no empty pill on the stage.
    statusEl.hidden = !state.building && !state.status;
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
    // What the colored part IS in this mode: an image, a drawing or the letters.
    imgdepthRow.setBounds(0.2, 3, state.importMode === 'text' ? 'Letter depth' : state.importMode === 'image' ? 'Image depth' : 'Design depth');
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
    stemFitRow.setValue(state.stemFitMm);
    fitTestStepRow.setValue(state.fitTestStepMm.toFixed(2));
    syncFitTest(state.fitTestActive);
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
    viewTabs.setPressed('switch', state.showSwitch);

    // Update Import Mode tabs and panels
    importTabsCtl.setValue(state.importMode);
    const isBlockMode = state.importMode === 'blocks';
    $('imagePanel').hidden = state.importMode !== 'image';
    $('svgPanel').hidden = state.importMode !== 'svg';
    $('iconPanel').hidden = state.importMode !== 'icon';
    $('modelPanel').hidden = state.importMode !== 'model';
    // Text and Blocks share one panel — both are "type something, pick a font".
    $('letterPanel').hidden = state.importMode !== 'text' && !isBlockMode;
    $('blockLinesField').hidden = !isBlockMode;
    $('textLinesField').hidden = isBlockMode;
    textUi.setSymbols(state.textSymbols);
    blockUi.setSymbols(state.blockSymbols);
    // Lettering holds both modes' rows; each shows only in its own.
    for (const id of ['legendSizeRow', 'legendBoldRow']) $(id).hidden = !isBlockMode;
    for (const id of ['textScaleRow', 'textBoldRow', 'letterSpacingRow', 'lineSpacingRow']) {
      $(id).hidden = state.importMode !== 'text';
    }
    if (!isBlockMode) {
      textScaleRow.setValue(Math.round(state.textScale * 100));
      textBoldRow.setValue(state.textBold);
      letterSpacingRow.setValue(state.letterSpacing);
      lineSpacingRow.setValue(state.lineSpacing);
    }
    const keycapLink = document.getElementById('blocksKeycapLink');
    if (keycapLink) keycapLink.hidden = !isBlockMode;
    $('blockTextureMount').hidden = !isBlockMode;
    // The font list draws what will be printed: the blocks' keys, or Text mode's words.
    if (isBlockMode) setFontSample(state.blockLines.join(' '));
    else if (state.importMode === 'text') setFontSample(textLines.join(' '));
    if (isBlockMode) {
      const arr = arrangeBlocks(state.blockLayout, state.blockGridRows, state.blockGridCols,
        state.blockCells, state.blockLines, state.blockSymbols);
      blockLayoutCtl.setValue(state.blockLayout);
      $('blockGridSizeRow').hidden = state.blockLayout !== 'grid' && state.blockLayout !== 'custom';
      blockRowsRow.setValue(state.blockGridRows);
      blockColsRow.setValue(state.blockGridCols);
      $('blockKeyMapMount').hidden = isLineLayout(state.blockLayout);
      if (!isLineLayout(state.blockLayout)) {
        blockKeyMap.set(arr.grid.rows, arr.grid.cols, arr.grid.on, keyLegends(state, arr));
      }
      blockBordersToggle.setValue(state.blockStyle !== 'open');
      blockTextureCtl.setValue(state.blockTexture);
      renderBlockLines(state, arr);
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
       switch, and a block holds a switch exactly as the flat clicker does: `stemFitMm` already
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

    /* Model mode has its own sections (modelPanel.ts) for the cut, the switch, the size and the
       colours, so the image clicker's versions of those hide. What stays is what still means
       the same thing: the three fit controls and the fit test in Body & fit. The preview's
       switches hide too — Model mode floats them on the stage (modelMode.ts), so its rail
       opens on the one decision it is about.
       After the blocks pass on purpose — it resets `display` to '' for every mode but blocks. */
    const isModelMode = state.importMode === 'model';
    const hideForModel = (el: HTMLElement | null) => {
      if (el && isModelMode) el.style.display = 'none';
    };
    // Rows the blocks pass above already puts back on the way out of model mode…
    for (const mount of ['topthickMount', 'imgdepthMount', 'capProudMount', 'hollowMount']) {
      hideForModel(document.getElementById(mount)?.closest('.prow-stacked') as HTMLElement | null);
    }
    // Body: the image clicker's palette, or model mode's own colours.
    $('palette').hidden = isModelMode;
    // A model clicker is built by its own path, which has no maker's mark: its Seller/License
    // category says so instead of offering a mark that would not print.
    $('proMount').hidden = isModelMode;
    $('sellerModelNote').hidden = !isModelMode;
    placeLicence();
    $('modelColoursMount').hidden = !isModelMode;

    // The rail: the categories this source has, and the one it opens on when you arrive. A
    // category whose rows are all hidden for this source takes itself off as well.
    const railPlan = RAIL_FOR_MODE[state.importMode];
    for (const it of RAIL_ITEMS) settings.setVisible(it.id, railPlan.show.includes(it.id));
    if (state.importMode !== railMode) {
      railMode = state.importMode;
      settings.open(railPlan.first);
    }

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
    viewTabs.setPressed('cut', state.sectionOn);
    const cutRowEl = document.getElementById('stageCutRow');
    if (cutRowEl) cutRowEl.hidden = !state.sectionOn;
    cutAxis = state.sectionAxis;
    cutBar.setValue(state.sectionAxis);
    cutPos.setValue(Math.round(state.sectionPos * 100));

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
    if (editModes) editModes.root.style.display = state.importMode === 'model' ? 'none' : '';

    // --- Undo / redo / refresh toolbar ---
    history.setState({ canUndo: state.canUndo, canRedo: state.canRedo, canRefresh: state.canRefresh });

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
      lettersBar?.setPressed('letters', state.separateLetters);
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
      for (const sel of ['.vl-overlay', '.vl-license-toast']) {
        document.querySelectorAll(sel).forEach((n) => n.remove());
      }
    },
    /** A font chosen elsewhere: a loaded project. */
    setFont: (id: string) => fontBlock.setValue(id),
    /** Text mode's text set elsewhere: a loaded project. */
    setText: (text: string) => {
      textLines = text.split('\n').slice(0, MAX_TEXT_LINES);
      if (!textLines.length) textLines = [''];
      renderTextLines();
    },
  };
}
