import { BRAND } from '@vostok/brand';
import {
  button,
  type ButtonHandle,
  buttonRow,
  changelogButton,
  iconButton,
  modeBar,
  textareaField,
  thumbTile,
  toggleSwitch,
  type ValueRow,
  dpad,
  generatorHeader,
  ICONS,
  qualityCallout,
  segmentedControl,
  sidebarFooter,
  sliderRow,
  stepperRow,
  makeCollapsible,
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

/** Fallback swatch for the keycap row before the build derives a contrasting frame. */
const DEFAULT_CAP_RGB: RGB = [240, 240, 240];

export interface UiState {
  status: string;
  building: boolean;
  hasParts: boolean;
  colorCount: number;
  palette: PaletteEntry[];
  baseShape: BaseShapeKind;
  capWidthMm: number;
  topThickness: number;
  imageDepth: number;
  /** How far the cap stands proud of the body border at rest, mm. */
  capProud: number;
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
  /** Current edit mode for the 3D viewport. */
  editMode: EditMode;
  /** Edge modification settings (fillet / chamfer). */
  edgeSettings: EdgeSetting[];
  /** Global toggle: chamfer every raised (extruded) color part. Not tied to selection. */
  extrudeChamfer: boolean;
  /** Text mode: when true each letter is its own selectable/colorable part. Default false. */
  separateLetters: boolean;
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
  onSample(load: () => Promise<RgbaImage>): void;
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
  /** Rotate the keychain attachment around the body edge by delta degrees. */
  onKeychainRotate(deltaDeg: number): void;
  /** Change the keychain ring hole diameter by delta mm. */
  onKeychainSize(deltaMm: number): void;
  /** Slide the keychain attachment along the body edge by delta mm. */
  onKeychainOffset(deltaMm: number): void;
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
  onUndo(): void;
  onRedo(): void;
  onRefresh(): void;
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

  /** Signed millimetre offset, for a control whose 0 is a baseline rather than zero. */
  const fmtSignedMm = (v: number, dec: number) =>
    (v > 0.0001 ? '+' : v < -0.0001 ? '−' : '') + Math.abs(v).toFixed(dec) + ' mm';

  // Small "?" help marker with a hover tooltip (tooltip itself is rendered to
  // <body> by the handler below so it is never clipped by the scrolling sidebar).
  const tip = (text: string) =>
    `<span class="help-tip" tabindex="0" role="img" aria-label="Help: ${text.replace(/"/g, '&quot;')}" data-tip="${text.replace(/"/g, '&quot;')}">?</span>`;

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
  const leftScroll = document.createElement('div');
  leftScroll.className = 'vl-panel__scroll';
  leftScroll.innerHTML = `
    <div class="section" id="previewViewSection">
      <span class="label">Preview &amp; View</span>
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

    <div class="section" id="baseStyleSection">
      <span class="label">Base style ${tip('Outline follows your image silhouette. Shape places the image on a preset base such as a circle or square.')}</span>
      <div class="field">
        <div id="shapeTypeTabsMount" style="margin-bottom: 12px;"></div>
      </div>
      <div class="field" id="shapeSelectField" style="margin-bottom: 12px;">
        <label for="shapeSelect">Shape geometry ${tip('The preset base shape used when the Shape base style is selected.')}</label>
        <select id="shapeSelect">
          <option value="circle">Circle</option>
          <option value="square">Square</option>
          <option value="rect">Rectangle</option>
          <option value="hexagon">Hexagon</option>
          <option value="heart">Heart</option>
          <option value="star">Star</option>
          <option value="egg">Egg</option>
        </select>
      </div>
      <div class="prow-stacked">
        <div id="widthMount"></div>
      </div>
      <div class="field" id="imageNudgeField" style="display:none;">
        <label>Move design ${tip('Slide the artwork around inside the base shape. The shape grows to keep covering it, so you can sit a design high in a heart or off to one side without it spilling over the frame.')}</label>
        <div id="imageNudgePadMount"></div>
      </div>
    </div>

    <div id="geometrySettingsContainer">
      <details class="vl-section vl-section--collapsible" id="sectionColors">
        <summary>1 · Colors &amp; Smoothing</summary>
        <div class="vl-section__body">
        <div class="field" id="colorCountField">
          <label for="ccount">Colors ${tip('How many distinct filament colors the image is split into. Each color becomes a separate part in the export.')}</label>
          <select id="ccount">
            <option value="2">2 Colors</option>
            <option value="3">3 Colors</option>
            <option value="4">4 Colors</option>
            <option value="5">5 Colors</option>
            <option value="6">6 Colors</option>
            <option value="7">7 Colors</option>
            <option value="8">8 Colors</option>
            <option value="9">9 Colors</option>
            <option value="10">10 Colors</option>
            <option value="11">11 Colors</option>
            <option value="12">12 Colors</option>
          </select>
        </div>
        <div class="prow-stacked" id="smoothingField">
          <div id="smoothMount"></div>
        </div>
        <div class="palette" id="palette">
          <div class="hint">Load an image/vector to pick colors.</div>
        </div>
        </div>
      </details>

      <details class="vl-section vl-section--collapsible" id="sectionShape">
        <summary>2 · More Settings</summary>
        <div class="vl-section__body">
        <div class="keychain-panel" style="margin-bottom: 16px;">
          <div id="keychainMount" style="margin-bottom: 12px;"></div>
          <div id="keychainOpts" style="display:none;">
            <!-- Blocks mode: the loop welds onto an end block's outer face, so the only
                 choice is which end of the chain it hangs from. -->
            <div class="field" id="keychainEndField" style="display:none;">
              <label>Loop side ${tip('Which side of the block set the keyring loop hangs off.')}</label>
              <div id="keychainEndMount"></div>
            </div>
            <div class="prow-stacked" id="keychainAngleRow">
              <div class="prow-header">
                <label>Position ${tip('Slides the keychain attachment around the edge of the body.')}</label>
              </div>
              <div class="tol-stepper" id="keychainRotStepper">
                <button class="btn" id="keychainRotMinus" type="button" aria-label="Rotate counter-clockwise">⟲</button>
                <span class="tol-val" id="keychainAngleVal">90°</span>
                <button class="btn" id="keychainRotPlus" type="button" aria-label="Rotate clockwise">⟳</button>
              </div>
            </div>
            <div class="prow-stacked" id="keychainOffsetRow">
              <div class="prow-header">
                <label>Slide offset ${tip('Slides the keychain along the tangent of the body edge (fine-tuning).')}</label>
              </div>
              <div class="tol-stepper" id="keychainOffsetStepper">
                <button class="btn" id="keychainOffsetMinus" type="button" aria-label="Slide left">−</button>
                <span class="tol-val" id="keychainOffsetVal">0.0 mm</span>
                <button class="btn" id="keychainOffsetPlus" type="button" aria-label="Slide right">+</button>
              </div>
            </div>
            <div class="prow-stacked">
              <div class="prow-header">
                <label>Hole size ${tip('Diameter of the ring hole. Size it for a keyring, cord, or carabiner.')}</label>
              </div>
              <div class="tol-stepper" id="keychainSizeStepper">
                <button class="btn" id="keychainSizeMinus" type="button" aria-label="Smaller hole">−</button>
                <span class="tol-val" id="keychainSizeVal">5.2 mm</span>
                <button class="btn" id="keychainSizePlus" type="button" aria-label="Bigger hole">+</button>
              </div>
            </div>
          </div>
        </div>

        <div class="global-edges" id="globalEdges" style="display:none; margin-bottom: 16px;">
          <span class="gedge-heading">Edges ${tip('Round (fillet) or bevel (chamfer) the outer edges. “Cap top” shapes the keycap’s top rim. “Clicker base” shapes the body’s top and bottom edges together.')}</span>
          <div class="gedge-row">
            <span class="gedge-name">Cap top</span>
            <div class="edge-style-btns" data-edge="capTop">
              <button class="edge-style-btn active" data-style="none" type="button">None</button>
              <button class="edge-style-btn" data-style="fillet" type="button">Fillet</button>
              <button class="edge-style-btn" data-style="chamfer" type="button">Chamfer</button>
            </div>
            <div class="edge-size-btns gedge-size" data-edge="capTop" style="display:none;">
              <button class="btn edge-size-minus" type="button">−</button>
              <span class="edge-size-val"></span>
              <button class="btn edge-size-plus" type="button">+</button>
            </div>
          </div>
          <div class="gedge-row">
            <span class="gedge-name">Clicker base</span>
            <div class="edge-style-btns" data-edge="clickerBase">
              <button class="edge-style-btn active" data-style="none" type="button">None</button>
              <button class="edge-style-btn" data-style="fillet" type="button">Fillet</button>
              <button class="edge-style-btn" data-style="chamfer" type="button">Chamfer</button>
            </div>
            <div class="edge-size-btns gedge-size" data-edge="clickerBase" style="display:none;">
              <button class="btn edge-size-minus" type="button">−</button>
              <span class="edge-size-val"></span>
              <button class="btn edge-size-plus" type="button">+</button>
            </div>
          </div>
        </div>

        <div class="prow-stacked">
          <div id="topthickMount"></div>
        </div>
        <div class="prow-stacked">
          <div id="imgdepthMount"></div>
        </div>
        <div class="prow-stacked">
          <div id="capProudMount"></div>
        </div>
        <!-- The three fit controls. They are three because they are three different pairs of
             surfaces, and the old two were named after parts they did not touch. -->
        <div class="prow-stacked"><div id="gapTolMount"></div></div>
        <div class="prow-stacked"><div id="stemFitMount"></div></div>
        <div class="prow-stacked"><div id="socketFitMount"></div></div>
        <div class="prow-stacked">
          <p class="switch-pad-hint">Not sure what to set the two fits to? Print the test, try each tile on a real switch, then type the number that fits.</p>
          <div id="fitTestMount"></div>
        </div>
        </div>
      </details>

      <details class="vl-section vl-section--collapsible" id="sectionSwitch">
        <summary>3 · Switch</summary>
        <div class="vl-section__body">
        <div class="field" style="margin-bottom:10px;">
          <label>Switches ${tip('Use 1 to 3 MX switches for larger or wider designs, for more click points and stability. Each switch can be moved and rotated individually.')}</label>
          <div id="switchCountMount"></div>
        </div>
        <div class="tabs" id="switchChips" role="tablist" style="display:none; margin-bottom:10px;"></div>
        <p class="switch-pad-hint">Move &amp; rotate the MX switch ${tip('Slide and rotate the selected MX switch away from the design centre. Handy when a switch doesn\'t sit neatly in the centre of your design.')}</p>
        <div id="switchPadMount"></div>
        <button class="secondary" id="switchResetAll" type="button" style="display:none; width:100%; margin-top:8px;">Reset all switches</button>
        </div>
      </details>

      <!-- The Updates drawer, under the last section rather than in the sticky footer: it is
           read once in a while, and should not compete with the controls that are on screen
           the whole time. Same placement as the fold-up box generator. -->
      <div id="updatesMount"></div>
    </div>

    <div class="sidebar-sticky-footer">
      <div id="historyControls"></div>
    </div>
  `;

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
      <span class="label">Import Source ${tip('Switch between raster image, SVG vector, built-in icon, or custom text to create your clicker.')}</span>
      <div class="import-grid" id="importTabs">
        <button class="import-card active" data-mode="image" type="button">
          <span class="card-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
          </span>
          <span class="card-label">Image</span>
        </button>
        <button class="import-card" data-mode="svg" type="button">
          <span class="card-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
              <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
              <line x1="12" y1="22.08" x2="12" y2="12"/>
            </svg>
          </span>
          <span class="card-label">SVG</span>
        </button>
        <button class="import-card" data-mode="icon" type="button">
          <span class="card-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
              <line x1="9" y1="9" x2="9.01" y2="9"/>
              <line x1="15" y1="9" x2="15.01" y2="9"/>
            </svg>
          </span>
          <span class="card-label">Icon</span>
        </button>
        <button class="import-card" data-mode="text" type="button">
          <span class="card-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="4 7 4 4 20 4 20 7"/>
              <line x1="9" y1="20" x2="15" y2="20"/>
              <line x1="12" y1="4" x2="12" y2="20"/>
            </svg>
          </span>
          <span class="card-label">Text</span>
        </button>
        <button class="import-card" data-mode="blocks" type="button">
          <span class="card-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="7" width="6.5" height="10" rx="1.4"/>
              <rect x="8.75" y="7" width="6.5" height="10" rx="1.4"/>
              <rect x="15.5" y="7" width="6.5" height="10" rx="1.4"/>
            </svg>
          </span>
          <span class="card-label">Blocks</span>
        </button>
      </div>

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
        <div id="removeBgMount"></div>
        <span class="sample-heading">Choose a sample image</span>
        <div class="sample-inline-grid" id="sampleGrid">
          ${SAMPLES.map((s, idx) => `
            <div class="sample-inline-item" data-idx="${idx}" role="button" tabindex="0" aria-label="Use the ${s.name} sample">
              <img src="${s.src}" alt="${s.name}" />
              <span>${s.name}</span>
            </div>
          `).join('')}
        </div>
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

  const sampleGrid = $('sampleGrid');
  activateOnKey(sampleGrid);
  sampleGrid.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest('.sample-inline-item') as HTMLElement | null;
    if (item) {
      const idx = parseInt(item.dataset.idx!);
      cb.onSample(SAMPLES[idx].load);
    }
  });

  // Two views of one setting: the Image tab and the SVG tab each show it and either can
  // change it, so the sync pass pushes the store value back into both.
  const removeBgToggle = toggleSwitch({
    label: 'Remove background',
    help: 'Automatically removes a solid or near-uniform background from the uploaded image so only the subject is traced.',
    checked: initial.removeBg,
    onChange: (v) => cb.onRemoveBg(v),
  });
  $('removeBgMount').append(removeBgToggle);

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
    };
    const onOutside = (e: MouseEvent) => {
      if (!pop.contains(e.target as Node)) close();
    };
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
   *  already there when `replace` is set (used by the per-block editor). */
  function openSymbolPicker(index: number, replace = false) {
    const back = document.createElement('div');
    back.className = 'wz-overlay symbol-overlay';
    back.innerHTML = `
      <div class="wz-modal symbol-modal">
        <div class="wz-head">Add a symbol</div>
        <div class="wz-body">
          <input type="search" class="symbol-search" placeholder="Search symbols…" autocomplete="off" spellcheck="false" />
          <div class="symbol-grid"></div>
        </div>
        <div class="wz-foot"><button type="button" class="secondary symbol-cancel">Cancel</button></div>
      </div>`;
    document.body.appendChild(back);
    const grid = back.querySelector('.symbol-grid') as HTMLElement;
    const search = back.querySelector('.symbol-search') as HTMLInputElement;
    const close = () => {
      back.remove();
      document.removeEventListener('keydown', onKey);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    back.addEventListener('click', (e) => {
      if (e.target === back) close();
    });
    (back.querySelector('.symbol-cancel') as HTMLElement).addEventListener('click', close);

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
          close();
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
    search.focus();
  }

  /* Four segmented pickers that were hand-built `<button class="tab">` rows with delegated
     `closest('[data-x]')` listeners, plus a matching loop elsewhere that toggled `.active`
     by hand. `segmentedControl()` is both halves: `onChange` replaces the delegation and
     `setValue()` replaces the loop, so the two can no longer disagree — and it brings the
     sliding pill with it. */
  const keychainEndTabs = segmentedControl<KeychainSide>({
    options: [
      { value: 'left', label: 'Left' },
      { value: 'right', label: 'Right' },
      { value: 'top', label: 'Top' },
      { value: 'bottom', label: 'Bottom' },
    ],
    value: initial.keychainEnd,
    onChange: (v) => cb.onKeychainEnd(v),
  });
  $('keychainEndMount').append(keychainEndTabs);

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
    const extrudePanel = document.createElement('div');
    extrudePanel.id = 'extrudePanel';
    extrudePanel.className = 'edges-panel';
    extrudePanel.setAttribute('hidden', '');
    extrudePanel.innerHTML = `
      <div class="edges-title">Raise Part</div>
      <div id="extrudeLevelLabel" style="text-align:center; margin-top:8px; font-size:13px; color:var(--muted);">Level: 0</div>
      <div style="display:flex; gap:8px; margin-top:8px;">
        <button type="button" class="btn" id="extrudeMinus" style="flex:1; font-size:18px;">-</button>
        <button type="button" class="btn" id="extrudePlus" style="flex:1; font-size:18px;">+</button>
      </div>
      <div class="extrude-chamfer-row" id="extrudeChamferMount"></div>
      <div class="panel-hint">Raises or lowers the selected colour. Shift-click parts to select several.<br><br>No AMS? Raise one colour and print in a single filament, then swap filament at that layer.</div>
    `;
    viewport.appendChild(extrudePanel);

    extrudePanel.querySelector('#extrudeMinus')?.addEventListener('click', () => cb.onExtrudeStep(-1));
    extrudePanel.querySelector('#extrudePlus')?.addEventListener('click', () => cb.onExtrudeStep(1));
    // The kit toggle stays uncontrolled the way the raw checkbox was: the browser flips it on
    // click and we push the value out. update() only calls setValue() for programmatic changes
    // (undo/redo, project load), so it never fights the user's click.
    extrudeChamferToggle = toggleSwitch({
      label: 'Chamfer edges',
      checked: initial.extrudeChamfer,
      onChange: (v) => cb.onExtrudeChamfer(v),
    });
    extrudePanel.querySelector('#extrudeChamferMount')?.append(extrudeChamferToggle);

    // --- Edges Panel ---
    const edgesPanel = document.createElement('div');
    edgesPanel.id = 'edgesPanel';
    edgesPanel.className = 'edges-panel';
    edgesPanel.setAttribute('hidden', '');
    edgesPanel.innerHTML = `
      <div class="edges-title" id="edgesTitle">Edge Modifications</div>
      <div id="edgesContent"></div>
      <div class="panel-hint">Select a part to round (fillet) or bevel (chamfer) its top edge. Shift-click for several.</div>
    `;
    viewport.appendChild(edgesPanel);

    edgesPanel.addEventListener('click', (e) => {
      const targetEl = e.target as HTMLElement;
      
      const styleBtn = targetEl.closest('.edge-style-btn') as HTMLElement | null;
      if (styleBtn) {
        const btnsRow = styleBtn.closest('.edge-style-btns') as HTMLElement;
        btnsRow.querySelectorAll('.edge-style-btn').forEach(b => b.classList.remove('active'));
        styleBtn.classList.add('active');
        const target = btnsRow.dataset.edge;
        const style = styleBtn.dataset.style as EdgeSetting['style'];
        if (target) cb.onEdgeStyle(target, style);
      }

      if (targetEl.classList.contains('edge-size-minus') || targetEl.classList.contains('edge-size-plus')) {
        const sizeRow = targetEl.closest('.edge-size-btns') as HTMLElement;
        const target = sizeRow.dataset.edge;
        const delta = targetEl.classList.contains('edge-size-minus') ? -0.2 : 0.2;
        if (target) cb.onEdgeStep(target, delta);
      }
    });
  }

  // --- Import mode tabs ---
  const importTabs = $('importTabs');
  importTabs.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('[data-mode]') as HTMLElement | null;
    if (t) cb.onImportMode(t.dataset.mode as any);
  });

  // --- Colors ---
  const ccount = $<HTMLSelectElement>('ccount');
  ccount.value = String(initial.colorCount);
  ccount.addEventListener('change', () => cb.onColorCount(+ccount.value));
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
  const shapeSelect = $<HTMLSelectElement>('shapeSelect');

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
    onChange: (v) => cb.onShape(v === 'outline' ? 'outline' : (shapeSelect.value as BaseShapeKind)),
  });
  $('shapeTypeTabsMount').append(shapeTypeTabs);

  shapeSelect.addEventListener('change', () => {
    cb.onShape(shapeSelect.value as BaseShapeKind);
  });

  // --- Size sliders ---
  const widthRow = sliderRow({
    label: 'Size', help: 'Overall size of the clicker (its longest side, in mm). This scales the whole model proportionally, not just the width.',
    min: 20, max: 70, step: 1, value: initial.capWidthMm, unit: 'mm',
    onInput: (v) => cb.onWidth(v),
  });
  $('widthMount').append(widthRow);

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
  const capProudRow = sliderRow({
    label: 'Button height',
    help: 'How far the button stands above its surround before you press it. Lower makes the two halves sit closer to flush; higher gives a taller press. The build lowers this on its own if the border is too short for it.',
    min: 0.4, max: 6, step: 0.2, value: initial.capProud, unit: 'mm',
    onInput: (v) => cb.onCapProud(v),
  });
  $('capProudMount').append(capProudRow);

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
  $('switchChips').addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('[data-sw]') as HTMLElement | null;
    if (t) cb.onActiveSwitch(+t.dataset.sw!);
  });
  $('switchResetAll').addEventListener('click', () => cb.onSwitchResetAll());

  const keychainToggle = toggleSwitch({
    label: 'Keychain',
    help: 'Adds a keyring attachment to the body so you can clip the clicker to a keychain.',
    checked: initial.keychain.enabled,
    onChange: (v) => cb.onKeychainToggle(v),
  });
  $('keychainMount').append(keychainToggle);

  $('keychainRotMinus').addEventListener('click', () => cb.onKeychainRotate(-15));
  $('keychainRotPlus').addEventListener('click', () => cb.onKeychainRotate(15));
  $('keychainOffsetMinus').addEventListener('click', () => cb.onKeychainOffset(-1.0));
  $('keychainOffsetPlus').addEventListener('click', () => cb.onKeychainOffset(1.0));
  $('keychainSizeMinus').addEventListener('click', () => cb.onKeychainSize(-0.4));
  $('keychainSizePlus').addEventListener('click', () => cb.onKeychainSize(0.4));

  // --- Global edges (Shape & Size): cap-top + clicker-base fillet/chamfer ---
  const globalEdges = $('globalEdges');
  globalEdges.addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    const styleBtn = el.closest('.edge-style-btn') as HTMLElement | null;
    if (styleBtn) {
      const btnsRow = styleBtn.closest('.edge-style-btns') as HTMLElement;
      const target = btnsRow.dataset.edge;
      if (target) cb.onEdgeStyle(target, styleBtn.dataset.style as EdgeStyle);
      return;
    }
    const minus = el.closest('.edge-size-minus');
    const plus = el.closest('.edge-size-plus');
    if (minus || plus) {
      const sizeRow = el.closest('.edge-size-btns') as HTMLElement;
      const target = sizeRow.dataset.edge;
      if (target) cb.onEdgeStep(target, minus ? -0.2 : 0.2);
    }
  });

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

  // --- Help tooltips ---
  // A single bubble appended to <body> so it is never clipped by the scrolling
  // sidebar. Shown while hovering / focusing any ".help-tip" marker.
  const tipBubble = document.createElement('div');
  tipBubble.className = 'help-tip-bubble';
  tipBubble.hidden = true;
  document.body.appendChild(tipBubble);
  cleanups.push(() => tipBubble.remove());

  const showTip = (marker: HTMLElement) => {
    const text = marker.getAttribute('data-tip');
    if (!text) return;
    tipBubble.textContent = text;
    tipBubble.hidden = false;
    const r = marker.getBoundingClientRect();
    const bw = tipBubble.offsetWidth;
    const bh = tipBubble.offsetHeight;
    let left = r.left;
    if (left + bw > window.innerWidth - 8) left = window.innerWidth - bw - 8;
    left = Math.max(8, left);
    let top = r.bottom + 8;
    if (top + bh > window.innerHeight - 8) top = r.top - bh - 8; // flip above if no room
    tipBubble.style.left = `${left}px`;
    tipBubble.style.top = `${Math.max(8, top)}px`;
  };
  const hideTip = () => { tipBubble.hidden = true; };

  const onTipOver = (e: Event) => {
    const marker = (e.target as HTMLElement).closest('.help-tip') as HTMLElement | null;
    if (marker) showTip(marker);
  };
  const onTipOut = (e: Event) => {
    if ((e.target as HTMLElement).closest('.help-tip')) hideTip();
  };
  document.addEventListener('mouseover', onTipOver);
  document.addEventListener('mouseout', onTipOut);
  document.addEventListener('focusin', onTipOver);
  document.addEventListener('focusout', onTipOut);
  cleanups.push(() => {
    document.removeEventListener('mouseover', onTipOver);
    document.removeEventListener('mouseout', onTipOut);
    document.removeEventListener('focusin', onTipOver);
    document.removeEventListener('focusout', onTipOut);
  });


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

    const popover = document.createElement('div');
    popover.id = 'sbColorPopover';
    popover.className = 'color-popover';
    document.body.appendChild(popover);

    let done = false;
    const close = () => {
      if (done) return;
      done = true;
      popover.remove();
      document.removeEventListener('mousedown', dismiss);
      handlers.onClose?.();
    };

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
    inp.addEventListener('input', () => handlers.onSelect(inp.value));
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
  }

  function showSidebarColorPicker(
    triggerEl: HTMLElement,
    currentHex: string,
    options: [string, string][],
    onSelect: (hex: string) => void
  ) {
    const rect = triggerEl.getBoundingClientRect();
    showColorPopoverAt(rect.left, rect.bottom + 6, currentHex, options.map(([, hex]) => hexRgb(hex)), {
      onSelect,
    });
  }

  function renderPalette(
    palette: PaletteEntry[],
    bodyColorRgb: RGB,
    colorMode?: 'normal' | 'limited',
    limitedColors?: RGB[],
    blocks?: { capRgb: RGB },
    recolored = 0,
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

    const chipsToRender: [string, string][] = [];
    if (colorMode === 'limited' && limitedColors && limitedColors.length > 0) {
      limitedColors.forEach((rgb) => {
        chipsToRender.push(getFilamentNameAndHex(rgb));
      });
    } else {
      FILAMENTS.forEach(([name, hex]) => {
        chipsToRender.push([name, hex]);
      });
    }

    // Letter blocks print in exactly three filaments — the blocks, the caps, and the
    // legends — so the palette is those three rows, not one per letter.
    if (blocks) {
      const row = (label: string, rgb: RGB, title: string, onPick: (hex: string) => void) => {
        const el = document.createElement('div');
        el.className = 'fil-row body-row';
        el.innerHTML = `
          <span class="slot-no slot-body">${label}</span>
          <span class="swatch" style="background:${rgbHex(rgb)}" title="${title}"></span>
          <span class="arrow">→</span>
          <button type="button" class="fil-chip" title="${title}" style="background:${rgbHex(rgb)}"></button>`;
        const chip = el.querySelector('.fil-chip') as HTMLElement;
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          showSidebarColorPicker(chip, rgbHex(rgb), chipsToRender, onPick);
        });
        pal.appendChild(el);
      };
      row('Body', bodyColorRgb, 'block body color', (hex) => cb.onBodyColor(hex));
      row('Caps', blocks.capRgb, 'keycap color', (hex) => cb.onCapColor(hex));
      row('Letters', palette[0]?.filamentRgb ?? [247, 247, 245], 'legend color', (hex) =>
        cb.onFilament(0, hex),
      );
      appendTip('Tip: click a block, a cap or a letter on the 3D model to recolor it.');
      return;
    }

    // ALWAYS render the Clicker Body row.
    const bodyRow = document.createElement('div');
    bodyRow.className = 'fil-row body-row';
    bodyRow.innerHTML = `
      <span class="slot-no slot-body">Body</span>
      <span class="swatch" style="background:#787c82; opacity: 0.5;" title="default body color"></span>
      <span class="arrow">→</span>
      <button type="button" class="fil-chip" title="clicker body color" style="background:${rgbHex(bodyColorRgb)}"></button>
    `;

    const bodyChip = bodyRow.querySelector('.fil-chip')!;
    bodyChip.addEventListener('click', (e) => {
      e.stopPropagation();
      showSidebarColorPicker(bodyChip as HTMLElement, rgbHex(bodyColorRgb), chipsToRender, (hex) => {
        cb.onBodyColor(hex);
      });
    });

    pal.appendChild(bodyRow);

    if (palette.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'hint';
      hint.textContent = 'Load an image/vector to pick colors.';
      pal.appendChild(hint);
    } else {
      palette.forEach((entry, i) => {
        const row = document.createElement('div');
        row.className = 'fil-row';
        row.innerHTML = `
          <span class="slot-no">${i + 1}</span>
          <span class="swatch" style="background:${rgbHex(entry.quantRgb)}" title="detected color"></span>
          <span class="arrow">→</span>
          <button type="button" class="fil-chip" title="filament" style="background:${rgbHex(entry.filamentRgb)}"></button>`;

        const chip = row.querySelector('.fil-chip')!;
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          showSidebarColorPicker(chip as HTMLElement, rgbHex(entry.filamentRgb), chipsToRender, (hex) => {
            cb.onFilament(i, hex);
          });
        });

        pal.appendChild(row);
      });

      appendTip('Tip: click a shape on the 3D model to recolor just that shape. A row above recolors its whole color.');
    }
  }

  function update(state: UiState) {
    statusEl.innerHTML = (state.building ? '<span class="spinner"></span> ' : '') + state.status;

    if (state.colorMode === 'limited') {
      ccount.disabled = true;
      let existingOpt = ccount.querySelector(`option[value="${state.colorCount}"]`);
      if (!existingOpt) {
        const opt = document.createElement('option');
        opt.value = String(state.colorCount);
        opt.textContent = `${state.colorCount} Colors (Limited)`;
        ccount.appendChild(opt);
      }
      ccount.value = String(state.colorCount);
    } else {
      ccount.disabled = false;
      ccount.querySelectorAll('option').forEach(opt => {
        if (opt.textContent?.includes('Limited')) {
          opt.remove();
        }
      });
      ccount.value = String(state.colorCount);
    }

    /* One call each now. These used to be pairs — the range's `.value` and a separate
       `setVal()` writing the text box — which is two places to keep in step. `setValue()`
       moves both, and skips the box write while it has focus so a rebuild cannot fight
       typing — the guard every app used to carry by hand now lives in the component. */
    smoothRow.setValue(state.smoothing);
    widthRow.setValue(state.capWidthMm);
    topthickRow.setValue(state.topThickness);
    imgdepthRow.setValue(state.imageDepth);
    capProudRow.setValue(state.capProud);
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
    // Active-switch chips (only shown for 2–3 switches).
    const chipsEl = document.getElementById('switchChips');
    if (chipsEl) {
      if (switchCountN > 1) {
        chipsEl.style.display = 'flex';
        if (chipsEl.querySelectorAll('[data-sw]').length !== switchCountN) {
          chipsEl.innerHTML = state.switches
            .map((_, i) => `<button class="tab" data-sw="${i}" type="button">S${i + 1}</button>`)
            .join('');
        }
        for (const b of chipsEl.querySelectorAll<HTMLElement>('[data-sw]')) {
          b.classList.toggle('active', +b.dataset.sw! === activeIdx);
        }
      } else {
        chipsEl.style.display = 'none';
      }
    }
    const resetAllEl = document.getElementById('switchResetAll');
    if (resetAllEl) resetAllEl.style.display = switchCountN > 1 ? 'block' : 'none';
    const kc = state.keychain;
    keychainToggle.setValue(kc.enabled);
    const kcOpts = document.getElementById('keychainOpts');
    if (kcOpts) kcOpts.style.display = kc.enabled ? '' : 'none';

    const kcAngleEl = document.getElementById('keychainAngleVal');
    if (kcAngleEl) kcAngleEl.textContent = `${Math.round((((kc.angleDeg % 360) + 360) % 360))}°`;
    const kcOffsetEl = document.getElementById('keychainOffsetVal');
    if (kcOffsetEl) kcOffsetEl.textContent = `${(kc.offsetMm ?? 0.0).toFixed(1)} mm`;
    const kcSizeEl = document.getElementById('keychainSizeVal');
    if (kcSizeEl) kcSizeEl.textContent = `${kc.holeDiameterMm.toFixed(1)} mm`;
    removeBgToggle.setValue(state.removeBg);
    removeBgSvgToggle.setValue(state.removeBg);
    showSwitchToggle.setValue(state.showSwitch);

    // Update Import Mode tabs and panels
    for (const b of importTabs.querySelectorAll<HTMLElement>('[data-mode]')) {
      b.classList.toggle('active', b.dataset.mode === state.importMode);
    }
    const isBlockMode = state.importMode === 'blocks';
    $('imagePanel').hidden = state.importMode !== 'image';
    $('svgPanel').hidden = state.importMode !== 'svg';
    $('iconPanel').hidden = state.importMode !== 'icon';
    // Text and Blocks share one panel — both are "type something, pick a font".
    $('letterPanel').hidden = state.importMode !== 'text' && !isBlockMode;
    $('blocksChainField').hidden = !isBlockMode;
    $('blocksSection').hidden = !isBlockMode;
    $('textOnlyField').hidden = isBlockMode;
    const keycapLink = document.getElementById('blocksKeycapLink');
    if (keycapLink) keycapLink.hidden = !isBlockMode;
    if (isBlockMode) {
      renderBlockChips(state.blockSlots);
      $('blocksTextField').hidden = false;
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
      keychainEndTabs.setValue(state.keychainEnd);
    }

    // Hide/show image specific fields in colors section
    const showSmoothingAndBg = state.importMode === 'image';
    const ccountField = $('colorCountField');
    const smoothingField = $('smoothingField');
    if (ccountField) ccountField.style.display = showSmoothingAndBg ? 'grid' : 'none';
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
    for (const mount of ['topthickMount', 'imgdepthMount', 'capProudMount', 'gapTolMount', 'socketFitMount', 'fitTestMount']) {
      hideForBlocks(document.getElementById(mount)?.closest('.prow-stacked') as HTMLElement | null);
    }
    // The keychain stays, but a block set has no round edge to slide a loop around, so it
    // welds to one side of the set instead.
    const kcEndField = document.getElementById('keychainEndField');
    if (kcEndField) kcEndField.style.display = isBlockMode ? '' : 'none';
    hideForBlocks(document.getElementById('keychainAngleRow'));
    hideForBlocks(document.getElementById('keychainOffsetRow'));
    hideForBlocks(document.getElementById('sectionSwitch'));

    shapeTypeTabs.setValue(treatAsOutline ? 'outline' : 'shape');

    if (treatAsOutline) {
      shapeSelect.disabled = true;
    } else {
      shapeSelect.disabled = false;
      shapeSelect.value = state.baseShape === 'outline' ? 'circle' : state.baseShape;
    }

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
        const plusBtn = extrudePanelEl.querySelector('#extrudePlus') as HTMLButtonElement;
        const minusBtn = extrudePanelEl.querySelector('#extrudeMinus') as HTMLButtonElement;
        const labelEl = extrudePanelEl.querySelector('#extrudeLevelLabel');
        // Global, part-independent toggle: always reflects the single flag.
        extrudeChamferToggle?.setValue(state.extrudeChamfer);

        if (state.selectedParts.length === 0) {
          if (plusBtn) plusBtn.disabled = true;
          if (minusBtn) minusBtn.disabled = true;
          if (labelEl) labelEl.textContent = 'Select a part';
        } else {
          if (plusBtn) plusBtn.disabled = false;
          if (minusBtn) minusBtn.disabled = false;
          if (labelEl) {
            const firstPart = state.selectedParts[0];
            const level = state.componentHeights[firstPart] ?? 0;
            const n = state.selectedParts.length;
            labelEl.textContent = n > 1
              ? `${n} parts selected · Level: ${level.toFixed(1)}`
              : `Level: ${level.toFixed(1)}`;
          }
        }
      } else {
        extrudePanelEl.setAttribute('hidden', '');
      }
    }

    // --- Global edges (left sidebar, Shape & Size). Always kept in sync, since they
    //     live outside the edit-mode panels. ---
    const globalEdgesEl = document.getElementById('globalEdges');
    if (globalEdgesEl) {
      for (const target of ['capTop', 'clickerBase']) {
        const es = state.edgeSettings.find(s => s.target === target) || { target, style: 'none' as EdgeStyle, radius: 0 };
        const btnsRow = globalEdgesEl.querySelector(`.edge-style-btns[data-edge="${target}"]`) as HTMLElement | null;
        const sizeRow = globalEdgesEl.querySelector(`.edge-size-btns[data-edge="${target}"]`) as HTMLElement | null;
        if (btnsRow) {
          btnsRow.querySelectorAll('.edge-style-btn').forEach(b => {
            b.classList.toggle('active', (b as HTMLElement).dataset.style === es.style);
          });
        }
        if (sizeRow) {
          const valEl = sizeRow.querySelector('.edge-size-val') as HTMLElement | null;
          if (es.style === 'none') {
            sizeRow.style.display = 'none';
          } else {
            sizeRow.style.display = 'flex';
            if (valEl) valEl.textContent = `${(es.radius ?? 1).toFixed(1)} mm`;
          }
        }
      }
    }

    // --- Edges panel (floating): per-part edges only. Global cap/base edges now live
    //     in the left sidebar, so with nothing selected we just prompt to pick a part. ---
    const edgesPanelEl = document.getElementById('edgesPanel');
    const edgesContentEl = document.getElementById('edgesContent');
    const edgesTitleEl = document.getElementById('edgesTitle');
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

          // Rebuild DOM only if targets changed (crude but effective)
          const currentTargets = Array.from(edgesContentEl.querySelectorAll('.edge-style-btns')).map(r => (r as HTMLElement).dataset.edge);
          if (targets.join(',') !== currentTargets.join(',')) {
            edgesContentEl.innerHTML = targets.map(t => {
              const label = friendlyTargetLabel(t);
              return `
                <div class="edge-label" title="${t}" style="margin-bottom: 4px;">${label} <span class="edge-radius-label" style="color:var(--muted);"></span></div>
                <div class="edge-style-btns" data-edge="${t}" style="margin-bottom: 8px;">
                  <button class="edge-style-btn active" data-style="none" type="button">None</button>
                  <button class="edge-style-btn" data-style="fillet" type="button">Fillet</button>
                  <button class="edge-style-btn" data-style="chamfer" type="button">Chamfer</button>
                </div>
                <div class="edge-size-btns" data-edge="${t}" style="gap:8px; margin-bottom: 12px; display: none;">
                  <button class="btn edge-size-minus" type="button" style="flex:1;">-</button>
                  <button class="btn edge-size-plus" type="button" style="flex:1;">+</button>
                </div>
              `;
            }).join('');
          }

          // Sync button state from edgeSettings
          for (const target of targets) {
            const es = state.edgeSettings.find(s => s.target === target) || { target, style: 'none' as EdgeStyle, radius: 1.0 };
            const btnsRow = edgesContentEl.querySelector(`.edge-style-btns[data-edge="${target}"]`) as HTMLElement;
            const sizeRow = edgesContentEl.querySelector(`.edge-size-btns[data-edge="${target}"]`) as HTMLElement;
            const labelRow = edgesContentEl.querySelector(`.edge-label[title="${target}"] .edge-radius-label`) as HTMLElement;

            if (btnsRow) {
              btnsRow.querySelectorAll('.edge-style-btn').forEach(b => {
                b.classList.toggle('active', (b as HTMLElement).dataset.style === es.style);
              });
            }
            if (sizeRow && labelRow) {
              if (es.style === 'none') {
                 sizeRow.style.display = 'none';
                 labelRow.textContent = '';
              } else {
                 sizeRow.style.display = 'flex';
                 const safeRadius = es.radius !== undefined ? es.radius : 1.0;
                 labelRow.textContent = `(${safeRadius.toFixed(1)} mm)`;
              }
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
