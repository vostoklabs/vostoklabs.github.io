import { BRAND } from '@vostok/brand';
import {
  button,
  dialog,
  helpTip,
  historyControls,
  type HistoryControlsHandle,
  selectField,
  thumbTile,
  toggleSwitch,
  type ValueRow,
  generatorHeader,
  ICONS,
  qualityCallout,
  segmentedControl,
  setExportNote,
  setFieldOptions,
  panelCredit,
  sidebarFooter,
  sampleGrid,
  type SampleGridHandle,
  sliderRow,
  stepperRow,
  makeCollapsible,
  modeBar,
  previewBar,
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
  uploadCta,
  colorPopover,
  closeColorPopover,
  paletteRow,
  listRow,
  type ListRowHandle,
  iconButton,
} from '@vostok/ui-kit';
import { MAKERLAB, SELLER_PACK, isUnlocked } from 'virtual:makerlab';
import type { BaseShapeKind, BlockStyle, BlockTexture, KeychainSide, EdgeSetting, KeychainParams, PaletteEntry, SwitchPlacement, ViewMode, RGB, Ring } from '../types';
import { FILAMENTS } from '../types';
import type { SectionAxis } from '../viewer/viewer';
import { SAMPLES } from '../image/sample';
import { srgbToOklab, type RgbaImage } from '@vostok/trace';
import { facesThatWrite, fontWritesText, STANDARD_FONTS } from '../image/letter';
import { FONTS, curatedFonts, getRequiredSubsets, toPickerFont } from '@vostok/fonts';
import { LUCIDE_ICONS, buildSvg, svgDataUrl } from '../image/lucideIcons';
import { CHANGELOG } from '../changelog';
import { entryForState, findShape, loadPackShapes, type ShapeEntry } from '../shapes/directory';
import { designUrl, inSeason, loadDesignImage, orderedDesignPacks } from '../packs';
import { openShapePicker } from './shapePicker';
import { STEM_FIT_MAX_MM, STEM_FIT_MIN_MM, STEM_FIT_STEP_MM } from '../geometry/stemFit';
import { FIT_TEST_STEP_OPTIONS } from '../geometry/fitStrip';
import type { ModelCutParams, ModelInfo, ModelMeta } from '../model/types';
import { modelFormatOf } from '@vostok/export/read';
import { arrangeBlocks, GRID_MAX, isLineLayout, keysPerRow, RIM_RAISE_MAX_MM, type BlockArrangement, type BlockLayout, type BlockSymbol } from '../geometry/blockLayout';
import { BODY_HEIGHT_MM } from '../geometry/keyBody';
import { assetUrl } from '../assets';
import { lookOf, lookRings } from '../image/symbolRings';
import { lucideImg, ringsSvg } from './symbols';
import { symbolLines, type LineSpec } from './symbolLines';
import { fmtSignedMm, readSigned } from './signedReadout';
import { RELIEF_MAX, RELIEF_MIN, reliefLevelOf, reliefMm } from '../relief';
import { wordsColour } from '../words';
import { capColourOf } from '../frame';
import type { MappedColour } from './wizard';

/** Fallback swatch for the keycap row before the build derives a contrasting frame. */
const DEFAULT_CAP_RGB: RGB = [240, 240, 240];

/** The left panel's categories, in rail order. Which ones a mode shows: `RAIL_FOR_MODE`. */
type RailId = 'layout' | 'shape' | 'cut' | 'model' | 'font' | 'lettering' | 'body' | 'colors' | 'relief' | 'switch' | 'keychain' | 'fit' | 'seller';

/** The licence and the seller tools: a category of their own, set apart at the end of the rail
 *  in every mode. Only the MakerWorld build has anything to put in it. */
const SELLER: RailId[] = MAKERLAB ? ['seller'] : [];

/** The categories each source has, and the one it opens on — the knob that makes the clicker
 *  that kind of clicker, never the font (Laser Studio's rule). The design comes first and Fit,
 *  which is about your printer and your switches rather than the design, comes last. */
const RAIL_FOR_MODE: Record<UiState['importMode'], { show: RailId[]; first: RailId }> = {
  // A picture's words are its Lettering category, called Text there, with the font in it too
  // (see `update()`): Add text is always there, and the font and the rest come with the words.
  image: { show: ['shape', 'lettering', 'body', 'colors', 'relief', 'switch', 'keychain', 'fit', ...SELLER], first: 'shape' },
  svg: { show: ['shape', 'lettering', 'body', 'colors', 'relief', 'switch', 'keychain', 'fit', ...SELLER], first: 'shape' },
  icon: { show: ['shape', 'lettering', 'body', 'colors', 'relief', 'switch', 'keychain', 'fit', ...SELLER], first: 'shape' },
  text: { show: ['shape', 'font', 'lettering', 'body', 'colors', 'relief', 'switch', 'keychain', 'fit', ...SELLER], first: 'shape' },
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

/** A line of words on a picture: where it sits on the cap and how big, in mm, +y up. */
export interface WordItem {
  id: string;
  text: string;
  x: number;
  y: number;
  /** The height of the line's box, mm. */
  heightMm: number;
  /** Degrees, counter-clockwise. */
  rotation: number;
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
  /** The picture turned on its base, degrees counter-clockwise (the Design view's grip). On an
   *  Outline base the whole silhouette turns. 0 = as drawn. */
  designRotation: number;
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
  /** The box the LAST build clamped every switch centre into, mm (`DesignLayout.switchBox`):
   *  the range of the switch's sliders. Read-only, like `builtBodyMm`; null before a build. */
  switchBox: { loX: number; hiX: number; loY: number; hiY: number } | null;
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
  /** Which switch the Switch sliders move (0-based). */
  activeSwitchIndex: number;
  smoothing: number;
  keychain: KeychainParams;
  removeBg: boolean;
  view: ViewMode;
  /** The stage shows the Design view rather than the 3D model. Viewport state, like `view`: not
   *  undone, not saved. */
  designView: boolean;
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
  /** How a picture's colours were chosen: split automatically into `colorCount` ('normal'), a
   *  kept list with the rest folded into the nearest (projects saved before mapping, 'limited'),
   *  or every colour pointed at the filament it prints in by the import window ('mapped'). */
  colorMode: 'normal' | 'limited' | 'mapped';
  limitedColors: RGB[];
  /** 'mapped': every colour found in the picture and the group it prints in. */
  mappedColors: MappedColour[];
  /** 'mapped': each group's filament, by group. */
  mappedFilaments: RGB[];
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
  /** How far each colour is raised, in height steps, by palette index (Relief). A part set on
   *  its own in `componentHeights` wins over its colour's row. Absent = 0. */
  colourLevels: number[];
  /** Words on a picture (image, SVG, icon): cut into the cap first, so they cut through the art.
   *  Text mode's text is the design itself and does not use these. */
  words: WordItem[];
  /** The words' filament. Null = the design's darkest, so words add no filament. */
  wordsColorRgb: RGB | null;
  /** How far the words are raised, in Relief steps. */
  wordsLevel: number;
  /** Edge modification settings (fillet / chamfer). */
  edgeSettings: EdgeSetting[];
  /** Relief's Bevelled edges: how far the top edge of every raised colour is chamfered, mm;
   *  0 leaves them sharp. Not tied to selection. */
  extrudeChamferMm: number;
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
  /** How far the block body's rim is raised above the standard body, mm. */
  blockRimRaiseMm: number;
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
  /** Set the number of switches (1..3); replaces the layout with symmetric defaults. */
  /** Put another switch on, up to three. */
  onSwitchAdd(): void;
  /** Take one switch off; the last one stays. */
  onSwitchRemove(index: number): void;
  /** Reset every switch to the default layout. */
  onSwitchResetAll(): void;
  /** Which switch the Switch sliders move. */
  onActiveSwitch(index: number): void;
  /** Move or turn one switch, absolute mm from the centre and degrees; what is absent stays. */
  onSwitchMove(index: number, patch: { x?: number; y?: number; rotation?: number }): void;
  /** The picture's place on its base, absolute mm from the centre. */
  onImageOffset(x: number, y: number): void;
  /** The picture's turn, degrees. */
  onDesignRotation(deg: number): void;
  onKeychainToggle(on: boolean): void;
  /** Change the keychain ring hole diameter by delta mm. */
  onKeychainSize(deltaMm: number): void;
  /** Where the loop sits round the edge, degrees (90 is the top). */
  onKeychainAngle(deg: number): void;
  /** The loop's small shift along the edge from there, absolute mm. */
  onKeychainOffsetSet(mm: number): void;
  onRemoveBg(on: boolean): void;
  onView(mode: ViewMode): void;
  /** The stage shows the Design view (the top at true scale) instead of the 3D model. */
  onDesignView(on: boolean): void;
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
  /** Relief: raise one whole colour (a palette row), in height steps. */
  onColourLevel(index: number, level: number): void;
  /** Words on a picture: a new line, placed by the app. */
  onWordAdd(): void;
  /** A line of words retyped. */
  onWordText(index: number, text: string): void;
  /** A line of words taken off. */
  onWordRemove(index: number): void;
  /** The words' filament. */
  onWordsColor(hex: string): void;
  /** How far the words are raised, in Relief steps. */
  onWordsLevel(level: number): void;
  /** Lettering's Text size, mm, for the line Lettering is on (`onActiveWord`; the first line until
   *  another is picked). */
  onWordSize(mm: number): void;
  /** Which line of words Lettering's per-line rows set. */
  onActiveWord(id: string): void;
  /** Move or turn that line, absolute mm from the centre and degrees; what is absent stays. */
  onWordMove(id: string, patch: { x?: number; y?: number; rotation?: number }): void;
  /** Relief's Bevelled edges, mm: how far every raised colour's top edge is chamfered. */
  onExtrudeChamferMm(mm: number): void;
  /** Text mode: toggle splitting the word into per-letter parts. */
  onSeparateLetters(on: boolean): void;
  onLineSpacing(v: number): void;
  onLetterSpacing(v: number): void;
  onTextBold(mm: number): void;
  onTextScale(v: number): void;
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
  onBlockRimRaise(mm: number): void;
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

  let history: HistoryControlsHandle;
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
      <div id="shapeGridMount"></div>
      <div class="cg-shape-knobs" id="shapeKnobsMount"></div>
      <div id="shapePickMount"></div>
      <div class="prow-stacked"><div id="widthMount"></div></div>
      <div class="prow-stacked"><div id="designScaleMount"></div></div>
      <div class="prow-stacked"><div id="fixedSizeMount"></div></div>
      <div id="fixedSizeFields" hidden>
        <div class="prow-stacked"><div id="fixedWMount"></div></div>
        <div class="prow-stacked"><div id="fixedHMount"></div></div>
        <div id="fixedSizePresetMount"></div>
      </div>
      <div class="prow-stacked" id="artMoveXRow"><div id="artMoveXMount"></div></div>
      <div class="prow-stacked" id="artMoveYRow"><div id="artMoveYMount"></div></div>
      <div class="prow-stacked" id="artTurnRow"><div id="artTurnMount"></div></div>
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
      <div id="wordPickMount"></div>
      <div class="prow-stacked" id="wordSizeRow"><div id="wordSizeMount"></div></div>
      <div class="prow-stacked" id="wordMoveXRow"><div id="wordMoveXMount"></div></div>
      <div class="prow-stacked" id="wordMoveYRow"><div id="wordMoveYMount"></div></div>
      <div class="prow-stacked" id="wordTurnRow"><div id="wordTurnMount"></div></div>
    </div>
    <div data-rail="body">
      <div id="blockTextureMount"></div>
      <div class="prow-stacked" id="blockRimRow"><div id="blockRimMount"></div></div>
      <div class="prow-stacked"><div id="topthickMount"></div></div>
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
      <div id="separateLettersMount"></div>
      <div class="palette" id="palette">
        <div class="hint">Load an image/vector to pick colors.</div>
      </div>
      <div id="modelColoursMount"></div>
    </div>
    <div data-rail="relief">
      <div class="field" id="reliefLevelsField">
        <label>Raised by ${tip('How far each colour stands above the top. No AMS? Raise one colour, print in one filament, and swap filament at that layer.')}</label>
        <div class="cg-relief-rows" id="reliefRowsMount"></div>
      </div>
      <div id="reliefBevelMount"></div>
      <div class="prow-stacked"><div id="imgdepthMount"></div></div>
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
      <div class="cg-switch-list" id="switchListMount"></div>
      <div id="switchAddMount"></div>
      <div class="prow-stacked" id="switchMoveXRow"><div id="switchMoveXMount"></div></div>
      <div class="prow-stacked" id="switchMoveYRow"><div id="switchMoveYMount"></div></div>
      <div class="prow-stacked" id="switchTurnRow"><div id="switchTurnMount"></div></div>
      <div id="switchResetAllMount"></div>
    </div>
    <div data-rail="keychain">
      <div id="keychainMount"></div>
      <div id="keychainOpts" style="display:none;">
        <div class="prow-stacked" id="keychainAngleRow"><div id="keychainAngleMount"></div></div>
        <div class="prow-stacked" id="keychainOffsetRow"><div id="keychainOffsetMount"></div></div>

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
    { id: 'relief', label: 'Relief', icon: ICONS.mountain },
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

  sidebarLeft.replaceChildren();
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
  sidebarRight.replaceChildren();
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
        <div id="svgUploadMount"></div>
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

      <div class="field" id="wordsField" hidden>
        <div id="wordsLinesMount"></div>
        <div id="wordsAddMount"></div>
      </div>
    </div>
  `;
  resolveHelpTips(rightScroll);

  const rightFooter = sidebarFooter({
    // Also true in the embedded build, where nobody owns them: the embedded build has no
    // download path, so it has no Save or Load. The kit then draws only the theme toggle.
    // This used to be done by removing "the first action row" after the fact, and when the
    // kit folded its two rows into one that took Light mode with it.
    hostOwnsProjects: MAKERLAB || cb.hostOwnsProjects,
    formats: [{ id: '3mf', label: '3MF' }],
    onExport: () => cb.onExport(),
    onSave: () => cb.onSaveProject(),
    // The file the footer's own picker chose; none means a host draws Open itself.
    onLoad: (f?: File) => {
      if (f) cb.onLoadProject(f);
      else cb.onOpenFromHost?.();
    },
    themeStorageKey: 'clicker_theme',
  });

  sidebarRight.append(rightScroll, rightFooter);

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
  // With a host, its own picker opens; without one, the browser's dialog. Several files can be
  // picked, and the first is the one added, as it always was.
  const pickFile = cb.pickFile;
  $('svgUploadMount').replaceWith(uploadCta({
    label: 'Upload SVG file(s)',
    icon: ICONS.upload,
    accept: '.svg,image/svg+xml',
    multiple: true,
    ...(pickFile ? { pick: () => pickFile('svg', ['svg']) } : {}),
    onFiles: ([f]) => {
      if (f) cb.onSvgUpload(f);
    },
  }));

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
    galleryEl.replaceChildren();
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

  // --- Words on a picture: the rail's Text category ---
  /* A line per piece of words, each its own object on the cap, and Add text under them: the same
     line fields Text mode uses, without its symbols. A setting of the picture's clicker rather
     than what it is made from, so in the rail with the rest: a picture's Text category is the
     Lettering one renamed, the lines first, then the font, then how the lines are lettered and
     where they sit (see `update()`). */
  const MAX_WORDS = 3;
  const WORD_MAX = 24;
  /** The lines the fields were built for, by id, so typing never rebuilds the field under it. */
  let wordFieldsFor = '';
  let wordCount = 0;
  const wordsUi = symbolLines({
    placement: false,
    onSymbols: () => {},
    onLine: (i, text) => cb.onWordText(i, text),
  });
  $('wordsLinesMount').append(wordsUi.lines);
  const addWordBtn = button({
    label: 'Add text',
    icon: ICONS.plus,
    emphasis: 'secondary',
    block: true,
    onClick: () => cb.onWordAdd(),
  });
  $('wordsAddMount').append(addWordBtn);
  settings.panel('lettering')?.querySelector('.vl-section__body')?.prepend($('wordsField'));
  function renderWords(state: UiState) {
    const ids = state.words.map((w) => w.id).join();
    if (ids !== wordFieldsFor) {
      const added = state.words.length > wordCount;
      wordFieldsFor = ids;
      wordCount = state.words.length;
      wordsUi.setLines(
        state.words.map((_, i) => ({ label: `Line ${i + 1}`, maxLength: WORD_MAX, onRemove: () => cb.onWordRemove(i) })),
        state.words.map((w) => w.text),
      );
      if (added) wordsUi.focus(state.words.length - 1);
    } else {
      wordsUi.setValues(state.words.map((w) => w.text));
    }
    addWordBtn.hidden = state.words.length >= MAX_WORDS;
  }
  /* --- Moving things: the same rows wherever something moves ------------------------------
     Left / right, Up / down and Turn, in mm from the centre and degrees, for each line of words
     here, and for the picture and each switch further down; the keyring loop goes round the edge
     instead. The 2D view sets the same values by dragging and `update()` moves these to match,
     so either hand works in either view. With only the 2D view to move things, a 3D view gave no
     sign that anything could be moved at all. */
  const signedDeg = (v: number) => `${v > 0.5 ? '+' : v < -0.5 ? '−' : ''}${Math.abs(Math.round(v))}°`;
  /** A turn as the rows show it, in (-180, 180]. */
  const wrapTurn = (d: number) => {
    const r = ((d % 360) + 360) % 360;
    return r > 180 ? r - 360 : r;
  };
  /** A range read off a build, pulled onto the rows' 0.5 mm grid so that 0 stays on it. */
  const onGrid = (v: number, up: boolean) => (up ? Math.ceil(v * 2) : Math.floor(v * 2)) / 2;
  /** `centred`: 0 is where the thing starts, so the row offers the way back to it. */
  function moveRows(onX: (v: number) => void, onY: (v: number) => void, onTurn: (v: number) => void, centred: boolean) {
    const axis = (label: string, onInput: (v: number) => void) => sliderRow({
      label, min: -25, max: 25, step: 0.5, value: 0,
      ...(centred ? { defaultValue: 0 } : {}),
      format: (v) => fmtSignedMm(v, 1),
      parse: readSigned,
      onInput,
    });
    return {
      x: axis('Left / right', onX),
      y: axis('Up / down', onY),
      turn: sliderRow({
        label: 'Turn', min: -180, max: 180, step: 1, value: 0, defaultValue: 0,
        format: signedDeg,
        parse: readSigned,
        onInput: onTurn,
      }),
    };
  }

  /** The line Lettering's own rows set: picked under Line, or on the 2D view; else the first. */
  let activeWordId: string | null = null;
  const activeWord = () => {
    const words = latestState?.words ?? [];
    return words.find((w) => w.id === activeWordId) ?? words[0];
  };
  // With two or three lines, which one the rows under it set. Boldness and Letter spacing,
  // above it, are every line's.
  const wordPick = segmentedControl<'0' | '1' | '2'>({
    label: 'Line',
    options: [
      { value: '0', label: '1' },
      { value: '1', label: '2' },
      { value: '2', label: '3' },
    ],
    value: '0',
    onChange: (v) => {
      const w = latestState?.words[+v];
      if (w) cb.onActiveWord(w.id);
    },
  });
  $('wordPickMount').append(wordPick);
  const wordSizeRow = sliderRow({
    label: 'Text size',
    help: 'How tall the line prints.',
    min: 2, max: 30, step: 0.5, value: 6, unit: 'mm',
    onInput: (v) => cb.onWordSize(v),
  });
  $('wordSizeMount').append(wordSizeRow);
  const wordMove = moveRows(
    (x) => { const w = activeWord(); if (w) cb.onWordMove(w.id, { x }); },
    (y) => { const w = activeWord(); if (w) cb.onWordMove(w.id, { y }); },
    (rotation) => { const w = activeWord(); if (w) cb.onWordMove(w.id, { rotation }); },
    false,
  );
  $('wordMoveXMount').append(wordMove.x);
  $('wordMoveYMount').append(wordMove.y);
  $('wordTurnMount').append(wordMove.turn);

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
  /** The font block is a picture's Text category's (under its lines, in the rail's usual short
   *  grid) or the Font category's (Text and Blocks mode, filling it). See `placeFontBlock`. */
  let fontInText = false;
  function makeFontBlock(value: string): FontChooserHandle {
    return fontChooser({
      fonts: allFonts(),
      curated: cardsFor(),
      value,
      sample: fontSample,
      featuredLabel: fontNeeds ? 'Works with your text' : 'Popular',
      supports: fontWrites,
      fill: !fontInText,
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
  /** Move the font block to where the mode wants it, built for the room it has there. */
  function placeFontBlock(inText: boolean) {
    if (inText === fontInText) return;
    fontInText = inText;
    const next = makeFontBlock(fontBlock.getValue());
    fontBlock.remove();
    fontBlock = next;
    if (inText) $('wordsField').after(fontBlock);
    else settings.panel('font')?.querySelector('.vl-section__body')?.append(fontBlock);
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

  /* Body: the outside of the body, each option a picture of a real one. Every clicker but a cut
     model has it, one field for all of them (so a texture survives switching source); the flat
     clicker's body takes the same skin as the blocks' (buildClicker). */
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
    help: 'The pattern on the outside walls. It only adds to the wall, so everything still fits the same.',
    variant: 'tiles',
    columns: 2,
    options: TEXTURE_OPTIONS.map((o) => ({ ...o, image: assetUrl(`assets/textures/${o.value}.png`) })),
    value: initial.blockTexture,
    onChange: (v) => cb.onBlockTexture(v),
  });
  $('blockTextureMount').append(blockTextureCtl);

  /* Image mode's Body rim height, for blocks: the same direction (higher hides more of the
     key), but the number is the body's real height, underside to rim, the one calipers read.
     The store keeps how far the rim is raised, 0 = the standard body. */
  const blockRimRow = sliderRow({
    label: 'Body rim height',
    help: 'How tall the body is around the keycaps. Higher hides more of each keycap; they always stand proud enough to click.',
    min: 0, max: RIM_RAISE_MAX_MM, step: 0.2, value: initial.blockRimRaiseMm,
    format: (v) => `${(BODY_HEIGHT_MM + v).toFixed(1)} mm`,
    parse: (typed) => typed - BODY_HEIGHT_MM,
    onInput: (v) => cb.onBlockRimRaise(v),
  });
  $('blockRimMount').append(blockRimRow);

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

    /* The stage's top-left: 2D or 3D first, on a row of its own; then, in 3D, how the model is
       shown (the bar, filled in below); then Cut it open's own settings while it is on. One
       `stageTools()` with a row each, so they stack instead of colliding. A click on the model
       always means the same thing, the picker for that shape (its colour and how far it is
       raised, in mount.ts); Relief is a rail category. */
    const modeRow = stageRow([]);
    modeRow.id = 'stageModeRow';
    const viewRow = stageRow([]);
    viewRow.id = 'stageViewRow';
    const cutRow = stageRow([]);
    cutRow.id = 'stageCutRow';
    cutRow.hidden = true;
    viewport.appendChild(stageTools([modeRow, viewRow, cutRow]));
    // The tools take the label's slot.
    viewport.querySelector<HTMLElement>('.vl-stage__label')?.setAttribute('hidden', '');
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

  /* Text only: each letter its own part, so letters can be coloured and raised one at a time.
     It sat beside the Color / Raise bar on the stage; with that bar gone it lives with the
     colours it is about. */
  const separateLettersToggle = toggleSwitch({
    label: 'Separate letters',
    help: 'Each letter becomes its own part, so you can colour and raise letters one at a time.',
    checked: initial.separateLetters,
    onChange: (v) => cb.onSeparateLetters(v),
  });
  $('separateLettersMount').append(separateLettersToggle);

  // --- Relief ---
  /* How far each colour stands above the top, one row per filament, in the millimetres it prints
     (the geometry still counts in 0.6 mm steps). A click on a shape on the model sets that one
     shape instead, through the picker mount.ts opens there; a row sets the whole colour and
     clears the shapes of it that were set one by one, the rule the colour rows already follow. */
  // How far every raised colour's top edge is bevelled; shown once something is raised.
  const reliefBevelRow = sliderRow({
    label: 'Bevelled edges',
    help: 'Bevels the top edge of every raised colour, so a step reads as a facet rather than a sharp ledge.',
    min: 0, max: 1.2, step: 0.1, value: initial.extrudeChamferMm,
    format: (v) => (v < 0.05 ? 'Off' : `${v.toFixed(1)} mm`),
    onInput: (v) => cb.onExtrudeChamferMm(v),
  });
  $('reliefBevelMount').append(reliefBevelRow);
  /** The colours the rows were last built for, so a press (which repaints) does not rebuild the
   *  row under the pointer; only a new set of colours does. */
  let reliefKey = '';
  let reliefRows: ValueRow<number>[] = [];
  let reliefWordsRow: ValueRow<number> | null = null;
  function renderReliefRows(state: UiState, words: RGB | null) {
    const key = [...state.palette.map((p) => rgbHex(p.filamentRgb)), words ? `text:${rgbHex(words)}` : ''].join();
    if (key !== reliefKey) {
      reliefKey = key;
      const levelRow = (label: string, rgb: RGB, value: number, onInput: (level: number) => void) => stepperRow({
        label,
        swatch: rgbHex(rgb),
        min: RELIEF_MIN, max: RELIEF_MAX, value,
        format: reliefMm,
        // Typed in millimetres, kept in steps: "1.2" is two steps up.
        parse: (typed, raw) => reliefLevelOf(readSigned(typed, raw)),
        onInput,
      });
      reliefRows = state.palette.map((p, i) =>
        levelRow(getFilamentNameAndHex(p.filamentRgb)[0], p.filamentRgb, state.colourLevels[i] ?? 0, (level) => cb.onColourLevel(i, level)));
      // The words, when a picture has them: their own row, under the picture's colours.
      reliefWordsRow = words ? levelRow('Text', words, state.wordsLevel, (level) => cb.onWordsLevel(level)) : null;
      $('reliefRowsMount').replaceChildren(...reliefRows, ...(reliefWordsRow ? [reliefWordsRow] : []));
    }
    reliefRows.forEach((row, i) => row.setValue(state.colourLevels[i] ?? 0));
    reliefWordsRow?.setValue(state.wordsLevel);
  }

  // --- Shape ---

  /* The base, as pictures: Outline first (the design's own silhouette), then the shapes people
     pick most, and the whole directory a press away. It was two decisions and a drawer (Base
     style Outline | Shape, then Choose a shape) for what is one question, "what shape is it",
     and a shape is a picture. The tiles are the directory's thumbnails, made by the same ring
     functions the geometry uses (`shapePaths.ts`), so a tile cannot show what the build would
     not make. A shape from the drawer that is none of these takes the last tile, by name.
     Icon line-art makes a broken outline body, so in icon mode Outline is hidden, not greyed. */
  const GRID_SHAPES = ['circle', 'square', 'heart', 'star', 'ngon', 'shield', 'arch'] as const;
  type ShapeTile = 'outline' | (typeof GRID_SHAPES)[number] | 'other';
  /** A path in the directory's 40 × 40 box as a tile picture, in the mid grey the Layout tiles
   *  use: a picture tile takes a URL, so it cannot follow the theme's text colour. */
  const shapePicture = (d: string) => {
    const grey = '#8a94a6';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path d="${d}" fill="${grey}" fill-opacity="0.32" fill-rule="evenodd" stroke="${grey}" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  };
  /** Outline's picture until the design has been traced: a soft blob rather than nothing. */
  const OUTLINE_PLACEHOLDER = 'M20 6c8 0 14 5 14 13s-5 15-14 15S6 28 6 20 12 6 20 6z';
  /** Which tile the state is: an icon's outline base builds as a circle (buildParamsFor), and
   *  the hidden Hexagon entry is the six-sided Polygon. */
  const shapeTileOf = (s: Pick<UiState, 'baseShape' | 'packShapeToken' | 'importMode'>): { tile: ShapeTile; entry: ShapeEntry | null } => {
    if (isOutlineBase(s)) return { tile: 'outline', entry: null };
    if (s.baseShape === 'outline') return { tile: 'circle', entry: findShape('circle') };
    const entry = entryForState(s.baseShape, s.packShapeToken);
    if (entry && (GRID_SHAPES as readonly string[]).includes(entry.id)) return { tile: entry.id as ShapeTile, entry };
    if (entry?.id === 'hexagon') return { tile: 'ngon', entry };
    return { tile: 'other', entry };
  };
  /** The drawer's shape on the last tile, by directory id, so pressing it again brings it back. */
  let otherShapeId: string | null = null;
  let otherPictureId: string | null = null;
  const shapeGrid = segmentedControl<ShapeTile>({
    label: 'Shape',
    help: 'Outline follows the outline of your design. The others put your design on that shape.',
    variant: 'tiles',
    // Four a row in a settings rail: the kit's compact tiles, whose smaller names fit "Polygon".
    size: 'compact',
    columns: 4,
    options: [
      { value: 'outline', label: 'Outline', image: shapePicture(OUTLINE_PLACEHOLDER) },
      ...GRID_SHAPES.map((id) => {
        const entry = findShape(id)!;
        return { value: id, label: entry.name, image: shapePicture(entry.thumb) };
      }),
      { value: 'other' as const, label: 'Your shape', image: shapePicture(OUTLINE_PLACEHOLDER) },
    ],
    value: shapeTileOf(initial).tile,
    onChange: (v) => {
      if (v === 'outline') cb.onShape('outline');
      else if (v === 'other') { if (otherShapeId) cb.onShapePick(otherShapeId); }
      else cb.onShapePick(v);
    },
  });
  shapeGrid.setOptionVisible('other', false);
  $('shapeGridMount').append(shapeGrid);

  /** Outline's tile drawn from the design's own silhouette: normalised rings (longest side 1,
   *  centred, +y up) into the 40 × 40 box, every ring thinned to a picture's worth of points. */
  function setOutlinePicture(rings: Ring[] | null) {
    const parts: string[] = [];
    for (const ring of rings ?? []) {
      if (ring.length < 3) continue;
      const stride = Math.max(1, Math.ceil(ring.length / 160));
      const pts: string[] = [];
      for (let i = 0; i < ring.length; i += stride) {
        pts.push(`${(20 + ring[i][0] * 32).toFixed(1)} ${(20 - ring[i][1] * 32).toFixed(1)}`);
      }
      if (pts.length >= 3) parts.push(`M${pts.join('L')}Z`);
    }
    shapeGrid.setOptionImage('outline', shapePicture(parts.length ? parts.join('') : OUTLINE_PLACEHOLDER));
  }

  /* The chosen shape's own knobs, under the grid: a polygon's sides, a star's points and
     sharpness, a rounded square's corners. The tile that picks a shape and the knobs that change
     it are in one place, and only the shapes that have one show one. Rebuilt only when the shape
     changes, each row's range and default coming from the directory entry: a star's Sharpness is
     30-80% and a cross's Arm width 15-45%, different questions wearing the same field. */
  let knobsFor: string | null = null;
  let knobRows: { sides?: ValueRow<number>; corner?: ValueRow<number>; feature?: ValueRow<number> } = {};
  function paintShapeKnobs(state: UiState) {
    const entry = isOutlineBase(state) || state.baseShape === 'outline' ? null : entryForState(state.baseShape, state.packShapeToken);
    const id = entry && (entry.param || entry.corner || entry.feature) ? entry.id : null;
    const mount = $('shapeKnobsMount');
    if (id !== knobsFor) {
      knobsFor = id;
      knobRows = {};
      const rows: HTMLElement[] = [];
      if (entry && id) {
        if (entry.param) {
          rows.push((knobRows.sides = stepperRow({
            label: entry.param.label,
            help: 'How many sides or points the shape has.',
            min: entry.param.min, max: entry.param.max, step: entry.param.step, value: state.shapeSides,
            onInput: (v) => cb.onShapeSides(v),
          })));
        }
        if (entry.corner) {
          rows.push((knobRows.corner = sliderRow({
            label: entry.corner.label,
            help: 'How far the corners are rounded off.',
            min: entry.corner.min, max: entry.corner.max, step: entry.corner.step,
            value: Math.round(state.shapeCornerPct * 100), unit: '%',
            onInput: (v) => cb.onShapeCorner(v / 100),
          })));
        }
        if (entry.feature) {
          rows.push((knobRows.feature = sliderRow({
            label: entry.feature.label,
            help: 'How deep the shape cuts in: a star’s valleys, a cross’s arms.',
            min: entry.feature.min, max: entry.feature.max, step: entry.feature.step,
            value: Math.round(state.shapeArmPct * 100), unit: '%',
            onInput: (v) => cb.onShapeArm(v / 100),
          })));
        }
      }
      mount.replaceChildren(...rows);
    }
    mount.hidden = !knobsFor;
    knobRows.sides?.setValue(state.shapeSides);
    knobRows.corner?.setValue(Math.round(state.shapeCornerPct * 100));
    knobRows.feature?.setValue(Math.round(state.shapeArmPct * 100));
  }

  const shapeBtn = button({
    label: 'All shapes…',
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
          onPick: (entry) => cb.onShapePick(entry.id),
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
      rightScroll,
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

  // --- The switches, and the way back to the default layout ---
  const switchResetAll = button({
    label: 'Reset switch position',
    emphasis: 'secondary',
    block: true,
    onClick: () => cb.onSwitchResetAll(),
  });
  $('switchResetAllMount').replaceWith(switchResetAll);

  const keychainToggle = toggleSwitch({
    label: 'Keyring loop',
    help: 'Adds a keyring attachment to the body so you can clip the clicker to a keychain.',
    checked: initial.keychain.enabled,
    onChange: (v) => cb.onKeychainToggle(v),
  });
  $('keychainMount').append(keychainToggle);

  // The picture on its base (on an Outline base the picture IS the base, so only Turn shows).
  const artMove = moveRows(
    (x) => cb.onImageOffset(x, latestState?.imageOffset.y ?? 0),
    (y) => cb.onImageOffset(latestState?.imageOffset.x ?? 0, y),
    (deg) => cb.onDesignRotation(deg),
    true,
  );
  $('artMoveXMount').append(artMove.x);
  $('artMoveYMount').append(artMove.y);
  $('artTurnMount').append(artMove.turn);

  /* The switches: a row each, numbered as the 2D view numbers them. Picking one is picking it in
     2D too, and the rows under the list move it; × takes it off and Add switch puts another on,
     up to three. A switch picked in 2D is the one lit here. */
  const switchList = $('switchListMount');
  let switchRows: ListRowHandle[] = [];
  const switchAdd = button({
    label: 'Add switch',
    icon: ICONS.plus,
    emphasis: 'secondary',
    block: true,
    title: 'Up to three switches, for a larger or wider design: more places to press, and steadier.',
    onClick: () => cb.onSwitchAdd(),
  });
  $('switchAddMount').append(switchAdd);
  function renderSwitchList(state: UiState) {
    const n = state.switches.length;
    if (switchRows.length !== n) {
      const rows = state.switches.map((_, i) => {
        const row = listRow({ label: `Switch ${i + 1}`, onClick: () => cb.onActiveSwitch(i) });
        const badge = document.createElement('span');
        badge.className = 'cg-switch-badge';
        badge.setAttribute('aria-hidden', 'true');
        badge.textContent = String(i + 1);
        row.prepend(badge);
        const remove = iconButton({ icon: ICONS.close, label: `Remove switch ${i + 1}`, emphasis: 'ghost', onClick: () => cb.onSwitchRemove(i) });
        // The last one stays: a clicker needs a switch.
        remove.hidden = n < 2;
        const wrap = document.createElement('div');
        wrap.className = 'cg-switch-list__row';
        wrap.append(row, remove);
        return { row, wrap };
      });
      switchRows = rows.map((r) => r.row);
      switchList.replaceChildren(...rows.map((r) => r.wrap));
    }
    const at = Math.max(0, Math.min(state.activeSwitchIndex, n - 1));
    switchRows.forEach((row, i) => row.setActive(i === at));
    switchAdd.hidden = n >= 3;
  }
  const switchAt = () => Math.max(0, Math.min(latestState?.activeSwitchIndex ?? 0, (latestState?.switches.length ?? 1) - 1));
  const switchMove = moveRows(
    (x) => cb.onSwitchMove(switchAt(), { x }),
    (y) => cb.onSwitchMove(switchAt(), { y }),
    (rotation) => cb.onSwitchMove(switchAt(), { rotation }),
    false,
  );
  $('switchMoveXMount').append(switchMove.x);
  $('switchMoveYMount').append(switchMove.y);
  $('switchTurnMount').append(switchMove.turn);

  /* The loop: a bearing round the body's edge (90° = top), then a small slide along the edge from
     there, for a shape where the ray from the centre lands awkwardly (a heart, a star). Both are
     absolute, so a row always reports the value it shows. */
  const keychainAngleRow = sliderRow({
    label: 'Loop position',
    help: 'Where the keyring loop sits around the edge. 90° is the top.',
    min: 0, max: 360, step: 5, value: initial.keychain.angleDeg, unit: '°',
    onInput: (v) => cb.onKeychainAngle(v),
  });
  $('keychainAngleMount').append(keychainAngleRow);
  // Left/right arrows, as the block chain's slide has: it is a nudge along the edge, not a
  // swept quantity, so the arrows read the way the loop moves.
  const keychainOffsetRow = stepperRow({
    label: 'Fine offset',
    help: 'Slides the loop along the edge from where Loop position puts it.',
    min: -15, max: 15, step: 0.5, value: initial.keychain.offsetMm, unit: 'mm',
    arrows: 'horizontal',
    onInput: (v) => cb.onKeychainOffsetSet(v),
  });
  $('keychainOffsetMount').append(keychainOffsetRow);

  /* Was a hand-built `keychainSizeMinus/Plus` button pair around a plain `<span>`
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

  // --- Typeable value inputs: parse typed number, commit on Enter / blur ---

  /* The three sidebar sections are written into the innerHTML above, so
     `collapsibleSection()` never built them and they were the one part of the panel that
     snapped open in a single frame while the chevron beside them eased. `makeCollapsible`
     hands them the kit's animation without restructuring the template. */
  for (const d of document.querySelectorAll<HTMLDetailsElement>('details.vl-section--collapsible')) {
    makeCollapsible(d);
  }

  /* --- The stage's two modes, and the 3D one's own ways of looking ---
     2D lays the top out flat at true scale, where everything on it is dragged; 3D shows the
     clicker as it prints. The kit's mode pill, the stage's one choice, on a row above the 3D
     bar: the 2D view used to be a third tab beside Assembled and Exploded, which read as one
     more way of looking at the model rather than the other half of the app. Hidden for a block
     set and a cut model, which have no flat top to lay out. */
  const stageMode = modeBar<'2d' | '3d'>({
    modes: [
      { value: '2d', label: '2D', icon: ICONS.frame },
      { value: '3d', label: '3D', icon: ICONS.box },
    ],
    value: initial.designView ? '2d' : '3d',
    onChange: (v) => cb.onDesignView(v === '2d'),
  });
  stageMode.root.setAttribute('aria-label', 'View');
  document.getElementById('stageModeRow')?.append(stageMode.root);

  // In 3D: the arrangement as a pill pair, then the two preview-only switches as dots. Their
  // explanations are tooltips: the bar has no room for a "?".
  const viewTabs = previewBar<ViewMode>({
    label: '3D view',
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
  // Export / Save / Load / Help / theme live in the shared ui-kit sidebar footer (created
  // above); its callbacks call cb.onExport / cb.onSaveProject / cb.onLoadProject directly.

  // Help tooltips are the kit's `helpTip()` now (see `tip()` / `resolveHelpTips()` above) —
  // each marker owns its own bubble and positioning, so there is nothing left to wire here.

  /** The shelf filament nearest a colour, as a person sees it (Oklab): a row is now named after
   *  its filament, and by plain RGB distance a leaf green came out nearer Brown than Green. */
  function getFilamentNameAndHex(rgb: RGB): [string, string] {
    let bestHex = rgbHex(rgb);
    let bestName = 'Custom Color';
    let bestD = Infinity;
    const [l, a, b] = srgbToOklab(rgb);
    for (const [name, hex] of FILAMENTS) {
      const [fl, fa, fb] = srgbToOklab(hexRgb(hex));
      const d = (l - fl) ** 2 + (a - fa) ** 2 + (b - fb) ** 2;
      if (d < bestD) {
        bestD = d;
        bestHex = hex;
        bestName = name;
      }
    }
    return [bestName, bestHex];
  }

  /** What the colour picker offers, each chip named for the shelf filament nearest to it. */
  const offerOf = (options: RGB[]) => options.map((rgb) => ({ hex: rgbHex(rgb), name: getFilamentNameAndHex(rgb)[0] }));

  /** The kit's colour picker, anchored at (clientX, clientY): a palette row's chip or a click on
   *  a part of the model (mount.ts, Model mode). A colour made on its wheel joins the design's
   *  colours once, when the picker closes (cb.onCustomColor), never on every step of a drag. */
  function showColorPopoverAt(
    clientX: number,
    clientY: number,
    currentHex: string,
    options: RGB[],
    handlers: { onSelect: (hex: string) => void; onClose?: () => void; footer?: HTMLElement }
  ) {
    colorPopover({
      x: clientX,
      y: clientY,
      value: currentHex,
      options: offerOf(options),
      onSelect: handlers.onSelect,
      onCustom: (hex) => cb.onCustomColor(hex),
      onClose: handlers.onClose,
      ...(handlers.footer ? { footer: handlers.footer } : {}),
    });
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
    colorMode: UiState['colorMode'] | undefined,
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

  function renderPalette(
    palette: PaletteEntry[],
    bodyColorRgb: RGB,
    colorMode?: UiState['colorMode'],
    limitedColors?: RGB[],
    blocks?: { capRgb: RGB },
    recolored = 0,
    customColors: RGB[] = [],
    /** The words on a picture, when it has some: their own row, after the picture's colours. */
    wordsRgb: RGB | null = null,
    /** A mapped picture's colours and their groups: each filament row shows every colour of the
     *  picture that prints in it. */
    mapped: MappedColour[] = [],
    /** An image: its colours are chosen in the import window, which a button here reopens. */
    picture = false,
  ) {
    const pal = $('palette');
    pal.replaceChildren();

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

    /* One compact row per colour, the kit's: the name, and the chip holding the filament it
       prints in, opening the same picker a click on the 3D model opens with the same offered
       list (`colorOptionsFor`, above). A colour traced from the picture shows as a dot before
       the name (`detected`), beside the filament chosen to print it. */
    const offered = offerOf(colorOptionsFor(colorMode, limitedColors, customColors));
    const row = (label: string, value: string, onChange: (hex: string) => void, detected?: string | string[]) =>
      paletteRow({ label, value, options: offered, onChange, onCustom: (hex) => cb.onCustomColor(hex), ...(detected ? { detected } : {}) });

    // Letter blocks print in exactly three filaments — the blocks, the caps, and the
    // legends — so the palette is those three rows, not one per letter.
    if (blocks) {
      pal.append(row('Body', rgbHex(bodyColorRgb), (hex) => cb.onBodyColor(hex)));
      pal.append(row('Caps', rgbHex(blocks.capRgb), (hex) => cb.onCapColor(hex)));
      pal.append(row('Letters', rgbHex(palette[0]?.filamentRgb ?? [247, 247, 245]), (hex) => cb.onFilament(0, hex)));
      appendTip('Tip: click a block, a cap or a letter on the 3D model to recolor it.');
      return;
    }

    // ALWAYS render the Clicker Body row.
    pal.append(row('Body', rgbHex(bodyColorRgb), (hex) => cb.onBodyColor(hex)));

    if (palette.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'hint';
      hint.textContent = 'Load an image/vector to pick colors.';
      pal.appendChild(hint);
    } else {
      /* One row per filament, named for it. A mapped picture's row shows, as dots after the name,
         every colour of the picture that prints in it (two colours merged in the import window
         are one row, two dots); a row's chip recolours that filament, and which colours share a
         filament is changed in the window. */
      const same = (a: RGB, b: RGB) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
      palette.forEach((entry, i) => {
        const group = colorMode === 'mapped' ? mapped.find((c) => same(c.rgb, entry.quantRgb))?.group : undefined;
        const members = group === undefined ? [] : mapped.filter((c) => c.group === group).map((c) => rgbHex(c.rgb));
        const label = picture || colorMode === 'mapped' ? getFilamentNameAndHex(entry.filamentRgb)[0] : `Color ${i + 1}`;
        pal.append(row(label, rgbHex(entry.filamentRgb), (hex) => cb.onFilament(i, hex), members.length ? members : rgbHex(entry.quantRgb)));
      });
      if (wordsRgb) pal.append(row('Text', rgbHex(wordsRgb), (hex) => cb.onWordsColor(hex)));
      if (picture) {
        pal.append(button({
          label: 'Edit picture colours…',
          emphasis: 'secondary',
          block: true,
          onClick: () => cb.onAdjustImage(),
        }));
      }
      // Once shapes have been recoloured one by one, the way back: a row only resets its own
      // colour, so without this a scattered set of shape colours has no single undo.
      if (recolored > 0) {
        pal.appendChild(button({
          label: `Reset ${recolored} recolored shape${recolored === 1 ? '' : 's'}`,
          emphasis: 'ghost',
          block: true,
          className: 'reset-part-colors',
          title: 'Put every individually recolored shape back on its palette row',
          onClick: (e) => {
            e.stopPropagation();
            cb.onResetPartColors();
          },
        }));
      }
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
    /** The three sources a picture comes from, and whether this one has words on it. */
    const pictureMode = state.importMode === 'image' || state.importMode === 'svg' || state.importMode === 'icon';
    const hasWords = pictureMode && state.words.length > 0;
    const wordsRgb = hasWords ? wordsColour(state.palette, state.wordsColorRgb, capColourOf(state)) : null;
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
      state.colorMode !== 'normal' && !COLOR_COUNT_OPTIONS.some((o) => o.value === countStr)
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
    // How deep the colours go into the top, in Relief beside how far they rise: the letters in
    // Text mode, the colours everywhere else.
    imgdepthRow.setBounds(0.2, 3, state.importMode === 'text' ? 'Letter depth' : 'Colour depth');
    renderReliefRows(state, wordsRgb);
    // A bevel has an edge to bevel only once something stands above the face.
    const raised = state.colourLevels.some((l) => l > 0) || state.wordsLevel > 0
      || Object.values(state.componentHeights).some((l) => l > 0);
    $('reliefBevelMount').hidden = !raised;
    reliefBevelRow.setValue(state.extrudeChamferMm);
    separateLettersToggle.setValue(state.separateLetters);
    $('separateLettersMount').hidden = state.importMode !== 'text';
    capProudRow.setValue(RIM_SPAN - state.capProud);
    hollowToggle.setValue(state.hollowBase);
    lastBuiltBody = state.builtBodyMm;
    designScaleRow.setValue(Math.round((state.designScale ?? 1) * 100));
    // An outline base ignores it, so it goes away there rather than sitting greyed out. In Text
    // mode "Text size" is the same knob under a name that means something there, so this one
    // goes away too rather than being a second control fighting it.
    designScaleRow.hidden = state.importMode === 'text' || isOutlineBase(state);
    paintShapeKnobs(state);
    // The picture's place: on an Outline base the picture is the base, so it only turns.
    $('artMoveXRow').hidden = isOutlineBase(state);
    $('artMoveYRow').hidden = isOutlineBase(state);
    artMove.x.setValue(state.imageOffset.x);
    artMove.y.setValue(state.imageOffset.y);
    artMove.turn.setValue(wrapTurn(state.designRotation));
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
    switchResetAll.setLabel(switchCountN > 1 ? 'Reset switch positions' : 'Reset switch position');
    // The list, the one the rows move lit; then the rows, over the box the last build clamped the
    // switches into (before one, the base). An axis with no room is not offered.
    renderSwitchList(state);
    const switchIdx = Math.max(0, Math.min(state.activeSwitchIndex, switchCountN - 1));
    const sb = state.switchBox;
    const halfCap = onGrid(state.capWidthMm / 2, false);
    const swRange: [number, number, number, number] = sb
      ? [onGrid(sb.loX, true), onGrid(sb.hiX, false), onGrid(sb.loY, true), onGrid(sb.hiY, false)]
      : [-halfCap, halfCap, -halfCap, halfCap];
    const sw = state.switches[switchIdx];
    $('switchMoveXRow').hidden = swRange[0] >= swRange[1];
    $('switchMoveYRow').hidden = swRange[2] >= swRange[3];
    if (swRange[0] < swRange[1]) switchMove.x.setBounds(swRange[0], swRange[1]);
    if (swRange[2] < swRange[3]) switchMove.y.setBounds(swRange[2], swRange[3]);
    if (sw) {
      switchMove.x.setValue(sw.x);
      switchMove.y.setValue(sw.y);
      switchMove.turn.setValue(wrapTurn(sw.rotation));
    }
    const kc = state.keychain;
    keychainToggle.setValue(kc.enabled);
    const kcOpts = document.getElementById('keychainOpts');
    if (kcOpts) kcOpts.style.display = kc.enabled ? '' : 'none';
    keychainAngleRow.setValue(kc.angleDeg ?? 90);
    keychainOffsetRow.setValue(kc.offsetMm ?? 0);

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
    // Words on a picture: the field under the picture's own controls.
    $('wordsField').hidden = !pictureMode;
    // The font goes in with a picture's words, under them, once there are some.
    placeFontBlock(pictureMode);
    fontBlock.hidden = pictureMode && !hasWords;
    renderWords(state);
    // Lettering holds every mode's rows; each shows only where it means something. A picture's
    // words share Text mode's Boldness and Letter spacing, and size by the line (Text size, mm).
    for (const id of ['legendSizeRow', 'legendBoldRow']) $(id).hidden = !isBlockMode;
    // On an Outline base the letters are the shape, so Size (in Shape) is their size.
    $('textScaleRow').hidden = state.importMode !== 'text' || isOutlineBase(state);
    $('lineSpacingRow').hidden = state.importMode !== 'text';
    for (const id of ['textBoldRow', 'letterSpacingRow']) $(id).hidden = state.importMode !== 'text' && !hasWords;
    // A line of words at a time: its size and its place, under Line with two or three of them.
    for (const id of ['wordSizeRow', 'wordMoveXRow', 'wordMoveYRow', 'wordTurnRow']) $(id).hidden = !hasWords;
    $('wordPickMount').hidden = !hasWords || state.words.length < 2;
    if (hasWords) {
      const at = Math.max(0, state.words.findIndex((w) => w.id === activeWordId));
      const active = state.words[at];
      wordPick.setOptionVisible('2', state.words.length >= 3);
      wordPick.setValue(String(at) as '0' | '1' | '2');
      wordSizeRow.setValue(active.heightMm);
      // Anywhere on the cap and a little past it, where an Outline base grows a tab round them.
      const reach = onGrid(state.capWidthMm * 0.75, false);
      wordMove.x.setBounds(-reach, reach);
      wordMove.y.setBounds(-reach, reach);
      wordMove.x.setValue(active.x);
      wordMove.y.setValue(active.y);
      wordMove.turn.setValue(wrapTurn(active.rotation));
    }
    if (!isBlockMode) {
      textScaleRow.setValue(Math.round(state.textScale * 100));
      textBoldRow.setValue(state.textBold);
      letterSpacingRow.setValue(state.letterSpacing);
      lineSpacingRow.setValue(state.lineSpacing);
    }
    const keycapLink = document.getElementById('blocksKeycapLink');
    if (keycapLink) keycapLink.hidden = !isBlockMode;
    // Body, and with it the texture, is not a category of a cut model at all.
    blockTextureCtl.setValue(state.blockTexture);
    $('blockRimRow').hidden = !isBlockMode;
    // The font list draws what will be printed: the blocks' keys, Text mode's words, or the words
    // on a picture.
    if (isBlockMode) setFontSample(state.blockLines.join(' '));
    else if (state.importMode === 'text') setFontSample(textLines.join(' '));
    else if (hasWords) setFontSample(state.words.map((w) => w.text).join(' '));
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
      blockRimRow.setValue(state.blockRimRaiseMm);
      renderBlockLines(state, arr);
      legendSizeRow.setValue(state.legendScale);
      legendBoldRow.setValue(state.legendBold);
      blockSideTabs.setValue(state.keychainEnd);
      keychainSlideRow.setValue(state.keychainSlideMm ?? 0);
    }

    // An image's count and smoothing: only for one whose colours were never mapped (a project
    // saved before the import window mapped them). A mapped picture's colours, and how smooth
    // its outlines are, are chosen in the window, which "Edit picture colours…" reopens.
    const showSmoothingAndBg = state.importMode === 'image' && state.colorMode !== 'mapped';
    // Named `...Wrap`, not `ccountField` — that name is the selectField() control itself now
    // (declared above, outside `update()`); this is only the wrapper div around its mount.
    const ccountFieldWrap = $('colorCountField');
    const smoothingField = $('smoothingField');
    if (ccountFieldWrap) ccountFieldWrap.style.display = showSmoothingAndBg ? 'grid' : 'none';
    if (smoothingField) smoothingField.style.display = showSmoothingAndBg ? 'grid' : 'none';

    // The shape tiles: Outline goes for icons (their line art makes a broken body), and a shape
    // from the drawer that is none of the tiles takes the last one, under its own name.
    const shapeNow = shapeTileOf(state);
    shapeGrid.setOptionVisible('outline', state.importMode !== 'icon');
    if (shapeNow.tile === 'other') {
      otherShapeId = shapeNow.entry?.id ?? null;
      shapeGrid.setOptionLabel('other', shapeNow.entry?.name ?? 'Your shape');
      const picId = shapeNow.entry?.id ?? '';
      if (picId !== otherPictureId) {
        otherPictureId = picId;
        shapeGrid.setOptionImage('other', shapePicture(shapeNow.entry?.thumb ?? OUTLINE_PLACEHOLDER));
      }
    }
    shapeGrid.setOptionVisible('other', shapeNow.tile === 'other');
    shapeGrid.setValue(shapeNow.tile);

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
    // welds to one side of the set instead: Side + Slide show. A flat clicker's loop goes round
    // its edge: Loop position and Fine offset, or dragged in 2D.
    const showForBlocks = (el: HTMLElement | null) => {
      if (el) el.style.display = isBlockMode ? '' : 'none';
    };
    showForBlocks(document.getElementById('keychainEndField'));
    showForBlocks(document.getElementById('keychainSlideRow'));
    showForBlocks(document.getElementById('keychainBlockResetMount'));
    hideForBlocks(document.getElementById('keychainAngleRow'));
    hideForBlocks(document.getElementById('keychainOffsetRow'));

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
      // A picture's Lettering is its Text: the words, their font and where they sit.
      settings.setLabel('lettering', pictureMode ? 'Text' : 'Lettering', { icon: pictureMode ? ICONS.text : ICONS.sliders });
      settings.open(railPlan.first);
    }

    // The stage's mode, then the 3D bar, set from the state rather than from their own clicks.
    // (A loop here once keyed the view tabs off `dataset.view` after the row stopped carrying it,
    // and stripped the selection off every tab: the label stayed `--muted` grey over an accent
    // pill, 1.03:1. Each control's own `setValue` is the only way a selection is shown.)
    // 2D is for the flat clickers: a block set has its key map, a cut model its own grip.
    const designable = pictureMode || state.importMode === 'text';
    $('stageModeRow').hidden = !designable;
    stageMode.setValue(state.designView ? '2d' : '3d');
    $('stageViewRow').hidden = state.designView;
    viewTabs.setValue(state.view);
    viewTabs.setPressed('cut', state.sectionOn);
    const cutRowEl = document.getElementById('stageCutRow');
    if (cutRowEl) cutRowEl.hidden = !state.sectionOn || state.designView;
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
      wordsRgb,
      state.mappedColors,
      state.importMode === 'image',
    );

    // Highlight the active icon in the Lucide gallery
    if (state.currentIconName) {
      galleryEl.querySelectorAll('.icon').forEach((n) => {
        n.classList.toggle('active', n.getAttribute('title') === state.currentIconName);
      });
    }

    // --- Undo / redo / refresh toolbar ---
    history.setState({ canUndo: state.canUndo, canRedo: state.canRedo, canRefresh: state.canRefresh });
  }

  return { 
    update, 
    hexRgb, 
    showColorPopoverAt,
    addUploadedSvg,
    /** The Outline tile drawn from a fresh trace's silhouette (null: the placeholder). */
    setOutlinePicture,
    /**
     * Undoes everything this UI put outside its two sidebars.
     *
     * An open colour picker is closed first, as its own close does, so its listeners leave the
     * document with it. The selector sweep at the end is for the other transient overlays — the
     * welcome modal, a tutorial card — which each already remove themselves on close, but only
     * if the user ever closes them. Unmounting mid-modal has to clear them too.
     */
    dispose: () => {
      closeColorPopover();
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
    /** Open a rail category: the one that answers to what was picked on the Design view. */
    openCategory: (id: 'shape' | 'lettering' | 'switch' | 'keychain') => settings.open(id),
    /** The words selected on the Design view, which Lettering's Text size then sizes alone. */
    setActiveWord: (id: string | null) => {
      activeWordId = id;
      if (latestState) update(latestState);
    },
  };
}
