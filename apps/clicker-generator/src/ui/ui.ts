import { generatorHeader, qualityCallout, sidebarFooter } from '@vostok/ui-kit';
import type { BaseShapeKind, EditMode, EdgeSetting, EdgeStyle, KeychainParams, PaletteEntry, SwitchPlacement, ViewMode, RGB } from '../types';
import { FILAMENTS } from '../types';
import type { SectionAxis } from '../viewer/viewer';
import { SAMPLES } from '../image/sample';
import type { RgbaImage } from '../image/decode';
import type { FontOption } from '../image/letter';
import { FONT_OPTIONS, loadBundledFonts } from '../image/letter';
import { LUCIDE_ICONS, buildSvg, svgDataUrl } from '../image/lucideIcons';

/** Neutral top↔base clearance (mm). The "Switch socket tolerance" stepper shows the
 *  offset from this baseline, so a fresh design reads 0. Keep in sync with the store default. */
const BASE_SOCKET_TOL = 0.4;

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
  /** Top↔base slip-fit clearance, mm ("switch socket" tolerance). Baseline 0.4 = 0 offset. */
  tolerance: number;
  /** XY scale offset (mm) on the cap's keycap-mount stem — "switch stem" tolerance. 0 = as authored. */
  stemTolerance: number;
  /** MX switch placements (1..3): each x/y offset (mm) + rotation (deg) from centre. */
  switches: SwitchPlacement[];
  /** Which switch the d-pad drives (0-based). */
  activeSwitchIndex: number;
  smoothing: number;
  keychain: KeychainParams;
  removeBg: boolean;
  view: ViewMode;
  showSwitch: boolean;
  importMode: 'image' | 'svg' | 'icon' | 'text';
  currentIconName: string;
  colorMode: 'normal' | 'limited';
  limitedColors: RGB[];
  bodyColorRgb: RGB;
  paletteOverrides: RGB[];
  /** Explicit cap-backing/frame color set by clicking it on the model (else derived). */
  baseColorOverride: RGB | null;
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
  onShape(kind: BaseShapeKind): void;
  onWidth(mm: number): void;
  onTopThickness(mm: number): void;
  onImageDepth(mm: number): void;
  /** Step the top↔base ("switch socket") tolerance by delta mm (+ looser, − tighter). */
  onSocketTolStep(delta: number): void;
  /** Step the "switch stem" tolerance by delta mm (+ looser / bigger stem, − tighter). */
  onStemTolStep(delta: number): void;
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
  onBodyColor(hex: string): void;

  // New callbacks for vector modes
  onImportMode(mode: 'image' | 'svg' | 'icon' | 'text'): void;
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
  onUndo(): void;
  onRedo(): void;
  onRefresh(): void;
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

export function createUi(
  sidebarLeft: HTMLElement,
  sidebarRight: HTMLElement,
  statusEl: HTMLElement,
  cb: UiCallbacks
) {
  // Small "?" help marker with a hover tooltip (tooltip itself is rendered to
  // <body> by the handler below so it is never clipped by the scrolling sidebar).
  const tip = (text: string) =>
    `<span class="help-tip" tabindex="0" role="img" aria-label="Help: ${text.replace(/"/g, '&quot;')}" data-tip="${text.replace(/"/g, '&quot;')}">?</span>`;

  const headerEl = generatorHeader({
    title: 'Clicker Generator',
    description: 'Generate printable 3D model of a clicker from an image',
  });

  const qualityEl = qualityCallout({
    html: 'For the best quality printed clicker, please use the print profile and instructions available on <a class="hint-link" href="https://makerworld.com/en/models/2980346" target="_blank" rel="noopener">MakerWorld</a>.',
    storageKey: 'clicker-quality-callout',
  });

  // Populate Left Sidebar (Settings + Preview)
  sidebarLeft.innerHTML = `
    <div class="section" id="previewViewSection">
      <span class="label">Preview &amp; View</span>
      <div class="tabs" id="viewTabs" role="tablist" style="margin-bottom: 12px;">
        <button class="tab active" data-view="assembled" type="button">Assembled</button>
        <button class="tab" data-view="exploded" type="button">Exploded</button>
      </div>
      <div class="switch-row">
        <span class="switch-label">Show MX switch ${tip('Shows a reference MX switch in the preview so you can check the fit. It is not part of the exported model.')}</span>
        <label class="toggle"><input id="showswitch" type="checkbox" /><span class="slider"></span></label>
      </div>
    </div>

    <div class="section" id="baseStyleSection">
      <span class="label">Base style ${tip('Outline follows your image silhouette. Shape places the image on a preset base such as a circle or square.')}</span>
      <div class="field">
        <div class="tabs" id="shapeTypeTabs" role="tablist" style="margin-bottom: 12px;">
          <button class="tab" data-style="outline" type="button">Outline</button>
          <button class="tab" data-style="shape" type="button">Shape</button>
        </div>
      </div>
      <div class="field" id="shapeSelectField" style="margin-bottom: 12px;">
        <label for="shapeSelect">Shape geometry ${tip('The preset base shape used when the Shape base style is selected.')}</label>
        <select id="shapeSelect">
          <option value="circle">Circle</option>
          <option value="square">Square</option>
          <option value="hexagon">Hexagon</option>
          <option value="heart">Heart</option>
          <option value="star">Star</option>
          <option value="egg">Egg</option>
        </select>
      </div>
      <div class="prow-stacked">
        <div class="prow-header">
          <label for="width">Size ${tip('Overall size of the clicker (its longest side, in mm). This scales the whole model proportionally, not just the width.')}</label>
          <input type="text" class="val" id="widthVal" />
        </div>
        <input type="range" id="width" min="20" max="70" step="1" />
      </div>
    </div>

    <div id="geometrySettingsContainer">
      <details class="section section-collapsible" id="sectionColors">
        <summary class="label collapsible-head">1 · Colors &amp; Smoothing</summary>
        <div class="collapsible-body">
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
          <div class="prow-header">
            <label for="smooth">Smoothing ${tip('Simplifies and smooths the traced outlines. Higher values give fewer, cleaner edges; lower keeps more fine detail.')}</label>
            <input type="text" class="val" id="smoothVal" />
          </div>
          <input type="range" id="smooth" min="0" max="1" step="0.05" />
        </div>
        <div class="palette" id="palette">
          <div class="hint">Load an image/vector to pick colors.</div>
        </div>
        </div>
      </details>

      <details class="section section-collapsible" id="sectionShape">
        <summary class="label collapsible-head">2 · More Settings</summary>
        <div class="collapsible-body">
        <div class="keychain-panel" style="margin-bottom: 16px;">
          <div class="switch-row" style="margin-bottom: 12px;">
            <span class="switch-label">Keychain ${tip('Adds a keyring attachment to the body so you can clip the clicker to a keychain.')}</span>
            <label class="toggle"><input id="keychain" type="checkbox" /><span class="slider"></span></label>
          </div>
          <div id="keychainOpts" style="display:none;">

            <div class="prow-stacked">
              <div class="prow-header">
                <label>Position ${tip('Slides the keychain attachment around the edge of the body.')}</label>
              </div>
              <div class="tol-stepper" id="keychainRotStepper">
                <button class="btn" id="keychainRotMinus" type="button" aria-label="Rotate counter-clockwise">⟲</button>
                <span class="tol-val" id="keychainAngleVal">90°</span>
                <button class="btn" id="keychainRotPlus" type="button" aria-label="Rotate clockwise">⟳</button>
              </div>
            </div>
            <div class="prow-stacked">
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
                <label>Hole size ${tip('Diameter of the ring hole — size it for a keyring, cord, or carabiner.')}</label>
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
          <div class="prow-header">
            <label for="topthick">Top thickness ${tip('Thickness of the solid top layer beneath the colored image, in mm.')}</label>
            <input type="text" class="val" id="topthickVal" />
          </div>
          <input type="range" id="topthick" min="1" max="4" step="0.1" />
        </div>
        <div class="prow-stacked">
          <div class="prow-header">
            <label for="imgdepth">Image depth ${tip('How far the colored image is raised into the top surface, in mm.')}</label>
            <input type="text" class="val" id="imgdepthVal" />
          </div>
          <input type="range" id="imgdepth" min="0.2" max="3" step="0.1" />
        </div>
        <div class="prow-stacked">
          <div class="prow-header">
            <label>Switch socket tolerance ${tip('Clearance between the top part and the base it presses into. Press + if the two halves are hard to fit together, − if they feel loose. 0 = default fit.')}</label>
          </div>
          <div class="tol-stepper" id="socketTolStepper">
            <button class="btn" id="socketTolMinus" type="button" aria-label="Tighter fit">−</button>
            <span class="tol-val" id="socketTolVal">0.00 mm</span>
            <button class="btn" id="socketTolPlus" type="button" aria-label="Looser fit">+</button>
          </div>
        </div>
        <div class="prow-stacked">
          <div class="prow-header">
            <label>Switch stem (top part) tolerance ${tip('Scales the stem under the top part that grips your MX switch. If the stem is too tight to push onto the switch, press + to loosen it; press − for a firmer grip. Adjusts in 0.2 mm steps.')}</label>
          </div>
          <div class="tol-stepper" id="stemTolStepper">
            <button class="btn" id="stemTolMinus" type="button" aria-label="Tighter stem">−</button>
            <span class="tol-val" id="stemTolVal">0.0 mm</span>
            <button class="btn" id="stemTolPlus" type="button" aria-label="Looser stem">+</button>
          </div>
        </div>
        </div>
      </details>

      <details class="section section-collapsible" id="sectionSwitch">
        <summary class="label collapsible-head">3 · Switch</summary>
        <div class="collapsible-body">
        <div class="field" style="margin-bottom:10px;">
          <label>Switches ${tip('Use 1–3 MX switches for larger or wider designs — more click points and stability. Each switch can be moved and rotated individually.')}</label>
          <div class="tabs" id="switchCount" role="tablist">
            <button class="tab active" data-count="1" type="button">1</button>
            <button class="tab" data-count="2" type="button">2</button>
            <button class="tab" data-count="3" type="button">3</button>
          </div>
        </div>
        <div class="tabs" id="switchChips" role="tablist" style="display:none; margin-bottom:10px;"></div>
        <p class="switch-pad-hint">Move &amp; rotate the MX switch ${tip('Slide and rotate the selected MX switch away from the design centre. Handy when a switch doesn\'t sit neatly in the centre of your design.')}</p>
        <div class="switch-pad" id="switchPad">
          <button type="button" class="switch-pad-btn pad-rotl" data-rot="3" aria-label="Rotate switch left" title="Rotate left">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
          </button>
          <button type="button" class="switch-pad-btn pad-rotr" data-rot="-3" aria-label="Rotate switch right" title="Rotate right">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
          </button>
          <button type="button" class="switch-pad-btn pad-up" data-dir="up" aria-label="Move switch up (toward top)">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>
          </button>
          <button type="button" class="switch-pad-btn pad-left" data-dir="left" aria-label="Move switch left">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
          </button>
          <button type="button" class="switch-pad-center" id="switchReset" aria-label="Center the switch" title="Center">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>
          </button>
          <button type="button" class="switch-pad-btn pad-right" data-dir="right" aria-label="Move switch right">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          </button>
          <button type="button" class="switch-pad-btn pad-down" data-dir="down" aria-label="Move switch down (toward bottom)">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>
          </button>
        </div>
        <div class="switch-pad-readout" id="switchReadout">Centered</div>
        <button class="secondary" id="switchResetAll" type="button" style="display:none; width:100%; margin-top:8px;">Reset all switches</button>
        </div>
      </details>
    </div>

    <div class="sidebar-sticky-footer">
      <div class="btn-row" id="historyControls">
        <button id="undoBtn" class="secondary" type="button" title="Undo (Ctrl+Z)" aria-label="Undo" disabled style="display: flex; justify-content: center; align-items: center;">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>
        </button>
        <button id="refreshBtn" class="secondary" type="button" title="Refresh to Original" aria-label="Refresh" disabled style="display: flex; justify-content: center; align-items: center;">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
        </button>
        <button id="redoBtn" class="secondary" type="button" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled style="display: flex; justify-content: center; align-items: center;">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>
        </button>
      </div>
    </div>
  `;

  sidebarLeft.prepend(...(qualityEl ? [headerEl, qualityEl] : [headerEl]));

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
      </div>

      <!-- Image Panel -->
      <div id="imagePanel" class="mode-panel">
        <div class="drop" id="drop">
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
        <div class="switch-row">
          <span class="switch-label">Remove background ${tip('Automatically removes a solid or near-uniform background from the uploaded image so only the subject is traced.')}</span>
          <label class="toggle"><input id="removebg" type="checkbox" /><span class="slider"></span></label>
        </div>
        <span class="sample-heading">Choose a sample image</span>
        <div class="sample-inline-grid" id="sampleGrid">
          ${SAMPLES.map((s, idx) => `
            <div class="sample-inline-item" data-idx="${idx}">
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
        <div class="switch-row">
          <span class="switch-label">Remove background ${tip('Drops a solid rectangle painted behind the artwork so only the logo is kept. Turn off to keep the SVG background.')}</span>
          <label class="toggle"><input id="removebgSvg" type="checkbox" /><span class="slider"></span></label>
        </div>
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

      <!-- Text Panel -->
      <div id="letterPanel" class="mode-panel" hidden>
        <div class="field">
          <label for="letterText">Custom Text</label>
          <textarea id="letterText" rows="2" maxlength="30" autocomplete="off" spellcheck="false" style="width: 100%; resize: vertical; min-height: 48px;">Custom\nText</textarea>
        </div>
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
    formats: [{ id: '3mf', label: '3MF' }],
    onExport: () => cb.onExport(),
    onSave: () => cb.onSaveProject(),
    onLoad: (f: File) => {
      // Forward the picked file to the hidden project-file input, whose change
      // handler (below) calls cb.onLoadProject.
      const dt = new DataTransfer();
      dt.items.add(f);
      projFileInput.files = dt.files;
      projFileInput.dispatchEvent(new Event('change', { bubbles: true }));
    },
    onHelp: () => showTutorialPrompt(),
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
  $('undoBtn')?.addEventListener('click', () => cb.onUndo());
  $('redoBtn')?.addEventListener('click', () => cb.onRedo());
  $('refreshBtn')?.addEventListener('click', () => cb.onRefresh());

  // --- Image ---
  const drop = $('drop');
  const file = $<HTMLInputElement>('file');
  drop.addEventListener('click', () => file.click());
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

  // Global drag & drop for the whole window
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
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
  });

  // Choose Sample Picker Modal
  // Inline sample grid: click a thumbnail to load it directly
  const sampleGrid = $('sampleGrid');
  sampleGrid.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest('.sample-inline-item') as HTMLElement | null;
    if (item) {
      const idx = parseInt(item.dataset.idx!);
      cb.onSample(SAMPLES[idx].load);
    }
  });

  $<HTMLInputElement>('removebg').addEventListener('change', (e) =>
    cb.onRemoveBg((e.target as HTMLInputElement).checked)
  );
  $<HTMLInputElement>('removebgSvg').addEventListener('change', (e) =>
    cb.onRemoveBg((e.target as HTMLInputElement).checked)
  );

  // --- SVG Panel Setup ---
  const svgUpload = $<HTMLInputElement>('svgUpload');
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
    const el = document.createElement('div');
    el.className = 'icon';
    el.title = name;
    const img = document.createElement('img');
    img.src = thumbUrl;
    img.alt = name;
    el.appendChild(img);
    el.addEventListener('click', () => onClick(el));
    return el;
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
  const letterText = $<HTMLTextAreaElement>('letterText');
  const fontGrid = $('fontGrid');
  const fontUpload = $<HTMLInputElement>('fontUpload');
  let selectedFontBtn: HTMLElement | null = null;

  letterText.addEventListener('input', () => {
    cb.onTextChange(letterText.value);
  });
  fontUpload.addEventListener('change', () => {
    const f = fontUpload.files?.[0];
    if (f) cb.onImportFont(f);
    fontUpload.value = '';
  });

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

    // --- Edit Mode Bar (Color / Extrude / Edges) ---
    const modeBar = document.createElement('div');
    modeBar.id = 'editModeBar';
    modeBar.className = 'edit-mode-bar';
    modeBar.innerHTML = `
      <button class="edit-mode-btn active" data-editmode="color" type="button">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>
        Color
      </button>
      <button class="edit-mode-btn" data-editmode="extrude" type="button">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>
        Extrude
      </button>
      <button class="edit-mode-btn" data-editmode="edges" type="button" style="display:none;">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4" ry="4"/></svg>
        Edges
      </button>
    `;
    viewport.appendChild(modeBar);
    modeBar.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-editmode]') as HTMLElement | null;
      if (btn) cb.onEditMode(btn.dataset.editmode as EditMode);
    });

    // --- Separate-letters toggle (text mode, Color + Extrude) ---
    // Off: the whole word is one element (select/recolor/extrude all letters together).
    // On: each letter is its own part, so you can pick and color letters individually.
    const lettersToggle = document.createElement('div');
    lettersToggle.id = 'lettersToggle';
    lettersToggle.className = 'letters-toggle';
    lettersToggle.setAttribute('hidden', '');
    lettersToggle.innerHTML = `
      <span>Separate letters</span>
      <label class="toggle"><input type="checkbox" id="separateLetters" /><span class="slider"></span></label>
    `;
    viewport.appendChild(lettersToggle);
    const separateEl = lettersToggle.querySelector('#separateLetters') as HTMLInputElement | null;
    separateEl?.addEventListener('change', () => {
      cb.onSeparateLetters(separateEl.checked);
    });

    // --- Extrude Panel ---
    const extrudePanel = document.createElement('div');
    extrudePanel.id = 'extrudePanel';
    extrudePanel.className = 'edges-panel';
    extrudePanel.setAttribute('hidden', '');
    extrudePanel.innerHTML = `
      <div class="edges-title">Extrude Part</div>
      <div id="extrudeLevelLabel" style="text-align:center; margin-top:8px; font-size:13px; color:var(--muted);">Level: 0</div>
      <div style="display:flex; gap:8px; margin-top:8px;">
        <button type="button" class="btn" id="extrudeMinus" style="flex:1; font-size:18px;">-</button>
        <button type="button" class="btn" id="extrudePlus" style="flex:1; font-size:18px;">+</button>
      </div>
      <div class="extrude-chamfer-row">
        <span>Chamfer edges</span>
        <label class="toggle"><input type="checkbox" id="extrudeChamfer" /><span class="slider"></span></label>
      </div>
      <div class="panel-hint">Raises or lowers the selected color. Shift-click parts to select several.</div>
    `;
    viewport.appendChild(extrudePanel);

    extrudePanel.querySelector('#extrudeMinus')?.addEventListener('click', () => cb.onExtrudeStep(-1));
    extrudePanel.querySelector('#extrudePlus')?.addEventListener('click', () => cb.onExtrudeStep(1));
    // Plain uncontrolled checkbox: let the browser flip it natively on click, then
    // push the new value to the app. update() only re-syncs `.checked` for programmatic
    // changes (undo/redo, project load) — it won't fight the user's click.
    const chamferEl = extrudePanel.querySelector('#extrudeChamfer') as HTMLInputElement | null;
    chamferEl?.addEventListener('change', () => {
      cb.onExtrudeChamfer(chamferEl.checked);
    });

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
  ccount.addEventListener('change', () => cb.onColorCount(+ccount.value));
  const smooth = $<HTMLInputElement>('smooth');
  smooth.addEventListener('input', () => cb.onSmoothing(+smooth.value));

  // --- Shape ---
  const shapeTypeTabs = $('shapeTypeTabs');
  const shapeSelect = $<HTMLSelectElement>('shapeSelect');

  shapeTypeTabs.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('[data-style]') as HTMLElement | null;
    if (!t) return;
    const style = t.dataset.style;
    if (style === 'outline') {
      cb.onShape('outline');
    } else {
      cb.onShape(shapeSelect.value as BaseShapeKind);
    }
  });

  shapeSelect.addEventListener('change', () => {
    cb.onShape(shapeSelect.value as BaseShapeKind);
  });

  // --- Size sliders ---
  const width = $<HTMLInputElement>('width');
  width.addEventListener('input', () => cb.onWidth(+width.value));
  const topthick = $<HTMLInputElement>('topthick');
  topthick.addEventListener('input', () => cb.onTopThickness(+topthick.value));
  const imgdepth = $<HTMLInputElement>('imgdepth');
  imgdepth.addEventListener('input', () => cb.onImageDepth(+imgdepth.value));

  // --- Fit steppers: socket (top↔base) 0.05 mm steps, stem (keycap mount) 0.2 mm steps.
  //     Both are 0-based (+ looser, − tighter). ---
  $('socketTolMinus').addEventListener('click', () => cb.onSocketTolStep(-0.05));
  $('socketTolPlus').addEventListener('click', () => cb.onSocketTolStep(0.05));
  $('stemTolMinus').addEventListener('click', () => cb.onStemTolStep(-0.2));
  $('stemTolPlus').addEventListener('click', () => cb.onStemTolStep(0.2));

  // --- Switch D-pad: arrows nudge one step; top corners rotate; center resets. ---
  const SWITCH_STEP = 1; // mm per click
  const switchPad = $('switchPad');
  switchPad.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const rotBtn = target.closest('[data-rot]') as HTMLElement | null;
    if (rotBtn) {
      cb.onSwitchRotate(+rotBtn.dataset.rot!);
      return;
    }
    const btn = target.closest('[data-dir]') as HTMLElement | null;
    if (!btn) return;
    switch (btn.dataset.dir) {
      case 'up': cb.onSwitchNudge(0, SWITCH_STEP); break;
      case 'down': cb.onSwitchNudge(0, -SWITCH_STEP); break;
      case 'left': cb.onSwitchNudge(-SWITCH_STEP, 0); break;
      case 'right': cb.onSwitchNudge(SWITCH_STEP, 0); break;
    }
  });
  $('switchReset').addEventListener('click', () => cb.onSwitchReset());

  // --- Switch count + active-switch chips + reset-all ---
  $('switchCount').addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('[data-count]') as HTMLElement | null;
    if (t) cb.onSwitchCount(+t.dataset.count!);
  });
  $('switchChips').addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('[data-sw]') as HTMLElement | null;
    if (t) cb.onActiveSwitch(+t.dataset.sw!);
  });
  $('switchResetAll').addEventListener('click', () => cb.onSwitchResetAll());

  const keychain = $<HTMLInputElement>('keychain');
  keychain.addEventListener('change', () => cb.onKeychainToggle(keychain.checked));

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
  function bindValInput(
    valId: string,
    slider: HTMLInputElement,
    callback: (v: number) => void,
    parse?: (raw: number) => number,
  ) {
    const el = $<HTMLInputElement>(valId);
    const commit = () => {
      const raw = parseFloat(el.value.replace(/[^0-9.\-]/g, ''));
      if (isNaN(raw)) return;
      const v = parse ? parse(raw) : raw;
      const clamped = Math.max(parseFloat(slider.min), Math.min(parseFloat(slider.max), v));
      slider.value = String(clamped);
      callback(clamped);
    };
    el.addEventListener('focus', () => el.select());
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); el.blur(); }
    });
    el.addEventListener('blur', commit);
  }

  bindValInput('smoothVal', smooth, cb.onSmoothing, (v) => v / 100);
  bindValInput('widthVal', width, cb.onWidth);
  bindValInput('topthickVal', topthick, cb.onTopThickness);
  bindValInput('imgdepthVal', imgdepth, cb.onImageDepth);

  // --- View tabs ---
  const viewTabs = $('viewTabs');
  viewTabs.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('[data-view]') as HTMLElement | null;
    if (t) cb.onView(t.dataset.view as ViewMode);
  });

  $<HTMLInputElement>('showswitch').addEventListener('change', (e) =>
    cb.onShowSwitch((e.target as HTMLInputElement).checked)
  );

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

  document.addEventListener('mouseover', (e) => {
    const marker = (e.target as HTMLElement).closest('.help-tip') as HTMLElement | null;
    if (marker) showTip(marker);
  });
  document.addEventListener('mouseout', (e) => {
    if ((e.target as HTMLElement).closest('.help-tip')) hideTip();
  });
  document.addEventListener('focusin', (e) => {
    const marker = (e.target as HTMLElement).closest('.help-tip') as HTMLElement | null;
    if (marker) showTip(marker);
  });
  document.addEventListener('focusout', (e) => {
    if ((e.target as HTMLElement).closest('.help-tip')) hideTip();
  });

  // --- Welcome / intro modal ---
  // Shown on every load (even on refresh) and re-openable via the header "?" button.
  function showWelcome() {
    // Avoid stacking duplicates if the help button is clicked repeatedly.
    if (document.querySelector('.welcome-overlay')) return;
    const wm = document.createElement('div');
    wm.className = 'welcome-overlay';
    wm.innerHTML = `
      <div class="welcome-card">
        <h2>Welcome to Clicker Generator 👋</h2>
        <p>Turn any image, SVG, icon, or text into a multi-color 3D printable clicker, ready for Bambu Studio or PrusaSlicer.</p>
        <div class="welcome-steps">
          <div class="welcome-step">
            <div class="welcome-step-num">1</div>
            <div class="welcome-step-text">
              <strong>Import your design</strong>
              <span>Drop an image or choose a sample, upload an SVG, pick a Lucide icon, or type custom text.</span>
            </div>
          </div>
          <div class="welcome-step">
            <div class="welcome-step-num">2</div>
            <div class="welcome-step-text">
              <strong>Configure the clicker</strong>
              <span>Pick colors &amp; filaments, choose a shape, adjust the size and depth.</span>
            </div>
          </div>
          <div class="welcome-step">
            <div class="welcome-step-num">3</div>
            <div class="welcome-step-text">
              <strong>Export &amp; print</strong>
              <span>Download the 3MF file and load it directly into your slicer. Each color is a separate part.</span>
            </div>
          </div>
        </div>
        <div class="welcome-foot">
          <button class="primary" id="welcomeClose" style="min-width:150px">Get started →</button>
        </div>
      </div>
    `;
    document.body.appendChild(wm);
    const close = () => {
      wm.remove();
      showUpdate();
    };
    wm.querySelector('#welcomeClose')!.addEventListener('click', close);
    // Also dismiss on backdrop click.
    wm.addEventListener('click', (e) => {
      if (e.target === wm) close();
    });
  }

  // --- "What's new" update notification ---
  // Shown once after the welcome modal, before the tutorial. Its "Don't show
  // again" flag is independent of the tutorial / welcome dismissal keys.
  const UPDATE_KEY = 'clicker_update_dismissed_2026_08';

  // Continue the on-load chain after welcome + update: open the tutorial unless
  // the user has permanently dismissed it.
  function continueAfterWelcome() {
    if (localStorage.getItem('clicker_tutorial_dismissed') !== 'true') {
      showTutorial();
    }
  }

  function showUpdate() {
    // Already dismissed for good → skip straight to the tutorial gate.
    if (localStorage.getItem(UPDATE_KEY) === 'true') {
      continueAfterWelcome();
      return;
    }
    if (document.querySelector('.welcome-overlay')) return;
    const wm = document.createElement('div');
    wm.className = 'welcome-overlay';
    const check = `<svg class="whats-new-check" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
    wm.innerHTML = `
      <div class="welcome-card whats-new-card">
        <div class="whats-new-badge">What's new</div>
        <h2>Latest updates ✨</h2>
        <p>A few improvements landed since your last visit:</p>
        <ul class="whats-new-list">
          <li>${check}<span><strong>Sharper image tracing</strong>: high-quality resampling, perceptual color matching, and detail-preserving smoothing keep fine text and small features intact.</span></li>
          <li>${check}<span><strong>Multiple switches</strong>: use 1–3 MX switches for bigger designs — each one moves and rotates on its own from the <em>Switch</em> section.</span></li>
          <li>${check}<span><strong>Keychain loop</strong>: add a keyring loop, slide it around the body edge, adjust its tangent slide offset, or resize the ring hole.</span></li>
          <li>${check}<span><strong>Polish &amp; fixes</strong>: lots of smaller improvements across the app.</span></li>
        </ul>
        <div class="whats-new-foot">
          <label class="whats-new-dismiss">
            <input type="checkbox" id="updateDontShow" />
            Don't show again
          </label>
          <button class="primary" id="updateClose" style="min-width:130px">Got it →</button>
        </div>
      </div>
    `;
    document.body.appendChild(wm);
    const dontShow = wm.querySelector('#updateDontShow') as HTMLInputElement;
    const close = () => {
      if (dontShow.checked) localStorage.setItem(UPDATE_KEY, 'true');
      wm.remove();
      continueAfterWelcome();
    };
    wm.querySelector('#updateClose')!.addEventListener('click', close);
    // Also dismiss on backdrop click (respects the checkbox too).
    wm.addEventListener('click', (e) => {
      if (e.target === wm) close();
    });
  }


  interface TutorialStep {
    focus: 'left' | 'center' | 'right';
    target: string;
    title: string;
    text: string;
    arrow: 'left' | 'right' | 'up' | 'down' | 'none';
    cardPosition?: 'left' | 'right';
  }

  const TUTORIAL_STEPS: TutorialStep[] = [
    {
      focus: 'right',
      target: '#importTabs',
      title: 'Import Source',
      text: 'Choose how to generate your 3D clicker model. You can upload any custom <strong>Image</strong> (PNG with transparency works best), choose from <strong>1700+ vector icons</strong>, import custom <strong>SVG</strong> files, or enter your own custom <strong>Text</strong>.',
      arrow: 'right'
    },
    {
      focus: 'right',
      target: '#export',
      title: 'Export 3MF Model',
      text: 'Once you are satisfied with your clicker design, click here to download the high-quality, print-ready <strong>3MF file</strong>. 3MF is the modern standard format which contains multi-color data, ready to open directly in your favorite slicer (such as Bambu Studio, OrcaSlicer, or PrusaSlicer).',
      arrow: 'right'
    },
    {
      focus: 'right',
      target: '#projectSettingsContainer',
      title: 'Project Settings',
      text: 'Save your work-in-progress clicker as a <code>.json</code> file to resume editing later, load previous projects, toggle between dark and light themes, or access this help guide.',
      arrow: 'right'
    },
    {
      focus: 'center',
      target: '#app',
      title: '3D Preview Viewport',
      text: 'This is where you can preview your design in 3D. Tip: <strong>Left-click & drag</strong> to orbit, <strong>Right-click & drag</strong> to pan, and <strong>Scroll</strong> to zoom.',
      arrow: 'none',
      cardPosition: 'left'
    },
    {
      focus: 'center',
      target: '#editModeBar',
      title: 'Paint & Height Modes',
      text: 'Switch between <strong>Color Mode</strong> (paint individual segments with different filament colors) and <strong>Extrude Mode</strong> (raise parts of the design, adjust their thickness and height, and chamfer the raised edges). Working with custom <strong>Text</strong>? Toggle <strong>Separate letters</strong> here to color or extrude each letter on its own.',
      arrow: 'up',
      cardPosition: 'left'
    },
    {
      focus: 'left',
      target: '#previewViewSection',
      title: 'Assembly Preview',
      text: 'Preview your model in an <strong>Assembled</strong> state or view it <strong>Exploded</strong> to see how all the 3D-printable parts fit together. You can also show a reference mechanical keyboard MX switch to check fitment.',
      arrow: 'left'
    },
    {
      focus: 'left',
      target: '#baseStyleSection',
      title: 'Base Outline Shape',
      text: 'Select the overall base shape for your clicker. You can choose a <strong>Custom Outline</strong> (which matches your imported graphic\'s boundaries), or standard geometries like a <strong>Circle</strong> or <strong>Hexagon</strong>. You can also scale the overall size here.',
      arrow: 'left'
    },
    {
      focus: 'left',
      target: '#geometrySettingsContainer',
      title: 'Geometry & Style Settings',
      text: 'Fine-tune your model in collapsible sections. <strong>1 · Colors &amp; Smoothing</strong> picks filament colors and smooths the outline. <strong>2 · More Settings</strong> adds a keychain loop, changes thicknesses, and dials in the <strong>switch socket &amp; stem fit tolerances</strong> that control how tightly the top and bottom parts clip together.',
      arrow: 'left'
    },
    {
      focus: 'left',
      target: '#sectionSwitch',
      title: 'Position the Switch',
      text: 'Open the <strong>3 · Switch</strong> section to <strong>move and rotate</strong> the MX switch. Handy when the switch doesn\'t sit neatly in the centre of your design.',
      arrow: 'left'
    },
    {
      focus: 'left',
      target: '#historyControls',
      title: 'Undo, Redo & Refresh',
      text: 'Use these buttons to easily undo or redo your design steps, or refresh the model to its original state.',
      arrow: 'left'
    }
  ];

  function showTutorial() {
    if (document.querySelector('.tutorial-card-container')) return;
    let stepIndex = 0;

    const backdrop = document.createElement('div');
    backdrop.className = 'tutorial-backdrop';

    const cardContainer = document.createElement('div');
    cardContainer.className = 'tutorial-card-container';
    
    const card = document.createElement('div');
    card.className = 'tutorial-card';
    
    const pointer = document.createElement('div');
    
    const renderStep = () => {
      const step = TUTORIAL_STEPS[stepIndex];
      document.body.className = `tutorial-active focus-${step.focus}`;
      
      // Explicitly set positioning inline to bypass CSS caching
      cardContainer.style.justifyContent = 'center';
      cardContainer.style.alignItems = 'center';
      cardContainer.style.paddingLeft = '0';
      cardContainer.style.paddingRight = '0';
      
      if (step.cardPosition === 'left') {
        cardContainer.style.justifyContent = 'flex-start';
        cardContainer.style.paddingLeft = '60px';
      } else if (step.cardPosition === 'right') {
        cardContainer.style.justifyContent = 'flex-end';
        cardContainer.style.paddingRight = '60px';
      }

      // Remove any existing highlights
      document.querySelectorAll('.tutorial-highlight').forEach(el => {
        el.classList.remove('tutorial-highlight');
      });

      // Highlight the target element
      const targetEl = document.querySelector(step.target) as HTMLElement;
      if (targetEl) {
        targetEl.classList.add('tutorial-highlight');
        // If it's a collapsible section, open it so its contents are visible
        // while the step describes them (e.g. the Switch move/rotate pad).
        if (targetEl instanceof HTMLDetailsElement) targetEl.open = true;
      }

      card.innerHTML = `
        <button class="tutorial-card-close" aria-label="Close">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
        <h3>${step.title} (${stepIndex + 1}/${TUTORIAL_STEPS.length})</h3>
        <p>${step.text}</p>
        <div class="tutorial-controls">
          <label class="tutorial-checkbox">
            <input type="checkbox" id="tutDontShow" ${localStorage.getItem('clicker_tutorial_dismissed') === 'true' ? 'checked' : ''} />
            Don't show again
          </label>
          <div class="tutorial-nav">
            <button class="secondary" id="tutPrev" ${stepIndex === 0 ? 'disabled' : ''}>Previous</button>
            <button class="primary" id="tutNext">${stepIndex === TUTORIAL_STEPS.length - 1 ? 'Finish' : 'Next'}</button>
          </div>
        </div>
      `;

      card.querySelector('.tutorial-card-close')!.addEventListener('click', closeTutorial);
      
      const dontShow = card.querySelector('#tutDontShow') as HTMLInputElement;
      dontShow.addEventListener('change', () => {
        if (dontShow.checked) {
          localStorage.setItem('clicker_tutorial_dismissed', 'true');
        } else {
          localStorage.removeItem('clicker_tutorial_dismissed');
        }
      });

      card.querySelector('#tutPrev')?.addEventListener('click', () => {
        if (stepIndex > 0) { stepIndex--; renderStep(); }
      });
      card.querySelector('#tutNext')?.addEventListener('click', () => {
        if (stepIndex < TUTORIAL_STEPS.length - 1) { stepIndex++; renderStep(); }
        else closeTutorial();
      });

      // Position the pointer
      if (targetEl && step.arrow !== 'none') {
        const rect = targetEl.getBoundingClientRect();
        pointer.className = `tutorial-pointer point-${step.arrow}`;
        pointer.style.display = 'block';
        
        let arrowOffsetTop = 0;
        let arrowOffsetLeft = 0;
        
        if (step.arrow === 'right') {
          arrowOffsetTop = rect.top + rect.height / 2 - 28;
          arrowOffsetLeft = rect.left - 70;
        } else if (step.arrow === 'left') {
          arrowOffsetTop = rect.top + rect.height / 2 - 28;
          arrowOffsetLeft = rect.right + 14;
        } else if (step.arrow === 'down') {
          arrowOffsetTop = rect.top - 70;
          arrowOffsetLeft = rect.left + rect.width / 2 - 28;
        } else if (step.arrow === 'up') {
          arrowOffsetTop = rect.bottom + 14;
          arrowOffsetLeft = rect.left + rect.width / 2 - 28;
        }
        
        pointer.style.top = `${arrowOffsetTop}px`;
        pointer.style.left = `${arrowOffsetLeft}px`;
        
        pointer.innerHTML = `
          <div class="tutorial-pointer-inner">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
              <line x1="5" y1="12" x2="19" y2="12"></line>
              <polyline points="12 5 19 12 12 19"></polyline>
            </svg>
          </div>
        `;
      } else {
        pointer.style.display = 'none';
      }
    };

    const closeTutorial = () => {
      document.body.classList.remove('tutorial-active', 'focus-left', 'focus-center', 'focus-right');
      document.querySelectorAll('.tutorial-highlight').forEach(el => {
        el.classList.remove('tutorial-highlight');
      });
      backdrop.remove();
      cardContainer.remove();
      pointer.remove();
    };

    cardContainer.appendChild(card);
    document.body.appendChild(backdrop);
    document.body.appendChild(cardContainer);
    document.body.appendChild(pointer);
    
    renderStep();
  }

  function showTutorialPrompt() {
    if (document.querySelector('.welcome-overlay') || document.querySelector('.tutorial-backdrop')) return;
    
    const wm = document.createElement('div');
    wm.className = 'welcome-overlay';
    wm.innerHTML = `
      <div class="welcome-card" style="align-items: center; text-align: center; width: 380px; padding: 32px;">
        <h2 style="margin-bottom: 8px;">Getting Started</h2>
        <p style="margin-bottom: 24px;">Do you want to see the interactive tutorial?</p>
        <div style="display: flex; gap: 12px; justify-content: center; width: 100%;">
          <button class="secondary" id="tutPromptNo" style="flex: 1;">No</button>
          <button class="primary" id="tutPromptYes" style="flex: 1;">Yes</button>
        </div>
      </div>
    `;
    document.body.appendChild(wm);
    
    const close = () => wm.remove();
    wm.querySelector('#tutPromptNo')!.addEventListener('click', close);
    wm.querySelector('#tutPromptYes')!.addEventListener('click', () => {
      close();
      showTutorial();
    });
  }

  // Always greet on load. The footer's Help button re-opens the tutorial prompt
  // (wired via the sidebarFooter onHelp callback above).
  showWelcome();

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

  function renderPalette(palette: PaletteEntry[], bodyColorRgb: RGB, colorMode?: 'normal' | 'limited', limitedColors?: RGB[]) {
    const pal = $('palette');
    pal.innerHTML = '';

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

      const tip = document.createElement('div');
      tip.className = 'hint model-recolor-tip';
      tip.textContent = 'Tip: click any color on the 3D model to recolor it.';
      pal.appendChild(tip);
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

    const setVal = (id: string, text: string) => {
      const el = $<HTMLInputElement>(id);
      if (document.activeElement !== el) el.value = text;
    };
    smooth.value = String(state.smoothing);
    setVal('smoothVal', Math.round(state.smoothing * 100) + '%');
    width.value = String(state.capWidthMm);
    setVal('widthVal', state.capWidthMm + ' mm');
    topthick.value = String(state.topThickness);
    setVal('topthickVal', state.topThickness.toFixed(1) + ' mm');
    imgdepth.value = String(state.imageDepth);
    setVal('imgdepthVal', state.imageDepth.toFixed(1) + ' mm');
    // Fit steppers show a signed offset from neutral, so a default design reads 0.
    const fmtSigned = (v: number, dec: number) =>
      (v > 0.0001 ? '+' : v < -0.0001 ? '−' : '') + Math.abs(v).toFixed(dec) + ' mm';
    const socketValEl = document.getElementById('socketTolVal');
    if (socketValEl) socketValEl.textContent = fmtSigned(state.tolerance - BASE_SOCKET_TOL, 2);
    const stemValEl = document.getElementById('stemTolVal');
    if (stemValEl) stemValEl.textContent = fmtSigned(state.stemTolerance, 1);
    const switchCountN = state.switches.length;
    const activeIdx = Math.min(state.activeSwitchIndex, switchCountN - 1);
    const active = state.switches[activeIdx] ?? { x: 0, y: 0, rotation: 0 };
    const swReadout = document.getElementById('switchReadout');
    if (swReadout) {
      const bits: string[] = [];
      if (Math.abs(active.x) >= 0.05 || Math.abs(active.y) >= 0.05) {
        bits.push(`X ${active.x > 0 ? '+' : ''}${active.x.toFixed(1)} · Y ${active.y > 0 ? '+' : ''}${active.y.toFixed(1)} mm`);
      }
      if (Math.abs(active.rotation) >= 0.5) bits.push(`${active.rotation > 0 ? '↺' : '↻'} ${Math.abs(active.rotation)}°`);
      const body = bits.length ? bits.join('  ·  ') : 'Centered';
      swReadout.textContent = switchCountN > 1 ? `S${activeIdx + 1} · ${body}` : body;
    }
    // Switch count segmented control.
    const switchCountEl = document.getElementById('switchCount');
    if (switchCountEl) {
      for (const b of switchCountEl.querySelectorAll<HTMLElement>('[data-count]')) {
        b.classList.toggle('active', +b.dataset.count! === switchCountN);
      }
    }
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
    keychain.checked = kc.enabled;
    const kcOpts = document.getElementById('keychainOpts');
    if (kcOpts) kcOpts.style.display = kc.enabled ? '' : 'none';

    const kcAngleEl = document.getElementById('keychainAngleVal');
    if (kcAngleEl) kcAngleEl.textContent = `${Math.round((((kc.angleDeg % 360) + 360) % 360))}°`;
    const kcOffsetEl = document.getElementById('keychainOffsetVal');
    if (kcOffsetEl) kcOffsetEl.textContent = `${(kc.offsetMm ?? 0.0).toFixed(1)} mm`;
    const kcSizeEl = document.getElementById('keychainSizeVal');
    if (kcSizeEl) kcSizeEl.textContent = `${kc.holeDiameterMm.toFixed(1)} mm`;
    $<HTMLInputElement>('removebg').checked = state.removeBg;
    $<HTMLInputElement>('removebgSvg').checked = state.removeBg;
    $<HTMLInputElement>('showswitch').checked = state.showSwitch;

    // Update Import Mode tabs and panels
    for (const b of importTabs.querySelectorAll<HTMLElement>('[data-mode]')) {
      b.classList.toggle('active', b.dataset.mode === state.importMode);
    }
    $('imagePanel').hidden = state.importMode !== 'image';
    $('svgPanel').hidden = state.importMode !== 'svg';
    $('iconPanel').hidden = state.importMode !== 'icon';
    $('letterPanel').hidden = state.importMode !== 'text';

    // Hide/show image specific fields in colors section
    const showSmoothingAndBg = state.importMode === 'image';
    const ccountField = $('colorCountField');
    const smoothingField = $('smoothingField');
    if (ccountField) ccountField.style.display = showSmoothingAndBg ? 'grid' : 'none';
    if (smoothingField) smoothingField.style.display = showSmoothingAndBg ? 'grid' : 'none';

    // Update Shape controls. Icons can't use the outline style (their thin
    // line-art makes a broken body), so the Outline tab is hidden for icon mode
    // and the body is always a solid shape.
    const outlineTab = shapeTypeTabs.querySelector<HTMLElement>('[data-style="outline"]');
    if (outlineTab) outlineTab.style.display = state.importMode === 'icon' ? 'none' : '';
    const treatAsOutline = state.baseShape === 'outline' && state.importMode !== 'icon';
    for (const btn of shapeTypeTabs.querySelectorAll<HTMLElement>('button')) {
      btn.classList.toggle('active', btn.dataset.style === (treatAsOutline ? 'outline' : 'shape'));
    }

    if (treatAsOutline) {
      shapeSelect.disabled = true;
    } else {
      shapeSelect.disabled = false;
      shapeSelect.value = state.baseShape === 'outline' ? 'circle' : state.baseShape;
    }

    // Update View tabs
    for (const b of viewTabs.querySelectorAll<HTMLElement>('button')) {
      b.classList.toggle('active', b.dataset.view === state.view);
    }

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

    renderPalette(state.palette, state.bodyColorRgb, state.colorMode, state.limitedColors);

    // Highlight the active icon in the Lucide gallery
    if (state.currentIconName) {
      galleryEl.querySelectorAll('.icon').forEach((n) => {
        n.classList.toggle('active', n.getAttribute('title') === state.currentIconName);
      });
    }

    // --- Edit mode bar ---
    const modeBarEl = document.getElementById('editModeBar');
    if (modeBarEl) {
      for (const b of modeBarEl.querySelectorAll<HTMLElement>('[data-editmode]')) {
        b.classList.toggle('active', b.dataset.editmode === state.editMode);
      }
    }

    // --- Undo / redo / refresh toolbar ---
    const undoBtn = document.getElementById('undoBtn') as HTMLButtonElement | null;
    const redoBtn = document.getElementById('redoBtn') as HTMLButtonElement | null;
    const refreshBtn = document.getElementById('refreshBtn') as HTMLButtonElement | null;
    if (undoBtn) undoBtn.disabled = !state.canUndo;
    if (redoBtn) redoBtn.disabled = !state.canRedo;
    if (refreshBtn) refreshBtn.disabled = !state.canRefresh;

    // --- Extrude tooltip ---
    const extrudeTooltipEl = document.getElementById('extrudeTooltip');
    if (extrudeTooltipEl) {
      extrudeTooltipEl.classList.toggle('hidden', state.editMode !== 'extrude');
    }

    // --- Edit mode UI toggles ---
    const modeBarBtns = document.querySelectorAll('.edit-mode-btn');
    modeBarBtns.forEach(b => {
      b.classList.toggle('active', (b as HTMLElement).dataset.editmode === state.editMode);
    });

    // --- Separate-letters toggle: text mode only, in Color + Extrude ---
    const lettersToggleEl = document.getElementById('lettersToggle');
    if (lettersToggleEl) {
      const showLetters = state.importMode === 'text'
        && (state.editMode === 'color' || state.editMode === 'extrude');
      lettersToggleEl.toggleAttribute('hidden', !showLetters);
      const sepInput = lettersToggleEl.querySelector('#separateLetters') as HTMLInputElement | null;
      if (sepInput) sepInput.checked = state.separateLetters;
    }

    // --- Extrude panel ---
    const extrudePanelEl = document.getElementById('extrudePanel');
    if (extrudePanelEl) {
      if (state.editMode === 'extrude') {
        extrudePanelEl.removeAttribute('hidden');
        const plusBtn = extrudePanelEl.querySelector('#extrudePlus') as HTMLButtonElement;
        const minusBtn = extrudePanelEl.querySelector('#extrudeMinus') as HTMLButtonElement;
        const labelEl = extrudePanelEl.querySelector('#extrudeLevelLabel');
        const chamferToggle = extrudePanelEl.querySelector('#extrudeChamfer') as HTMLInputElement | null;

        if (chamferToggle) {
          // Global, part-independent toggle: always pressable, reflects the single flag.
          chamferToggle.disabled = false;
          chamferToggle.checked = state.extrudeChamfer;
        }

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
    addFontOption: (font: FontOption) => { 
      addFontOption(font); 
      // Click the newly added font to select it
      const lastBtn = fontGrid.lastElementChild as HTMLElement;
      if (lastBtn) lastBtn.click();
    } 
  };
}
